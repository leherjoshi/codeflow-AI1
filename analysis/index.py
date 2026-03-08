"""
Analysis Lambda Function
Handles profile analysis: parse submissions, classify topics, calculate proficiency
"""

import json
import os
from typing import Dict, Any, List
from datetime import datetime, timezone
import boto3
from progress_tracking import (
    update_progress,
    check_streak_reset,
    MILESTONE_BADGES
)

# Initialize AWS clients
dynamodb = boto3.resource('dynamodb')
events_client = boto3.client('events')

users_table = dynamodb.Table(os.environ['USERS_TABLE'])
progress_table = dynamodb.Table(os.environ['PROGRESS_TABLE'])
analytics_table = dynamodb.Table(os.environ['ANALYTICS_TABLE'])

ENVIRONMENT = os.environ.get('ENVIRONMENT', 'dev')
def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Lambda handler for analysis endpoints
    
    Supported operations:
    - POST /analyze/profile: Analyze LeetCode profile
    - GET /analyze/{user_id}/topics: Get topic proficiency breakdown
    - POST /analyze/{user_id}/sync: Trigger manual sync
    - GET /progress/{user_id}: Get user progress with streak and badges
    - GET /admin/analytics/dau: Daily/Weekly/Monthly active users (admin only)
    - GET /admin/analytics/retention: User retention metrics (admin only)
    """
    
    try:
        http_method = event.get('httpMethod', '')
        path = event.get('path', '')
        body = json.loads(event.get('body', '{}')) if event.get('body') else {}
        path_parameters = event.get('pathParameters', {})
        headers = event.get('headers', {})
        
        # Route to appropriate handler
        if http_method == 'POST' and '/profile' in path:
            return handle_analyze_profile(body)
        elif http_method == 'GET' and '/topics' in path:
            user_id = path_parameters.get('user_id')
            return handle_get_topics(user_id)
        elif http_method == 'POST' and '/sync' in path:
            user_id = path_parameters.get('user_id')
            return handle_sync(user_id)
        elif http_method == 'GET' and '/progress' in path:
            user_id = path_parameters.get('user_id')
            return handle_get_progress(user_id)
        elif http_method == 'GET' and '/admin/analytics/dau' in path:
            return handle_admin_dau(headers)
        elif http_method == 'GET' and '/admin/analytics/retention' in path:
            return handle_admin_retention(headers)
        else:
            return {
                'statusCode': 404,
                'headers': get_cors_headers(),
                'body': json.dumps({'error': 'Not found'})
            }
    
    except Exception as e:
        print(f"Error in analysis handler: {str(e)}")
        return {
            'statusCode': 500,
            'headers': get_cors_headers(),
            'body': json.dumps({'error': 'Internal server error'})
        }
def handle_analyze_profile(body: Dict[str, Any]) -> Dict[str, Any]:
    """
    Analyze LeetCode profile and calculate topic proficiency
    
    Expected body:
    {
        "user_id": "string",
        "leetcode_username": "string",
        "submissions": List[Dict] (optional - if not provided, will use cached data)
    }
    """
    
    user_id = body.get('user_id')
    leetcode_username = body.get('leetcode_username')
    submissions = body.get('submissions')
    
    if not user_id or not leetcode_username:
        return {
            'statusCode': 400,
            'headers': get_cors_headers(),
            'body': json.dumps({'error': 'Missing required fields'})
        }
    
    try:
        # 1. Fetch profile data from Users table (cached by scraping service)
        user_data = fetch_user_profile(user_id)
        
        if not user_data or 'leetcode_profile' not in user_data:
            return {
                'statusCode': 404,
                'headers': get_cors_headers(),
                'body': json.dumps({
                    'error': 'Profile not found. Please sync with LeetCode first.'
                })
            }
        
        leetcode_profile = user_data['leetcode_profile']
        
        # 2. Get submissions data
        # If submissions not provided in request, try to get from cached profile
        if not submissions:
            submissions = leetcode_profile.get('submissions', [])
        
        # If still no submissions, use topic data from profile as fallback
        if not submissions:
            # Fallback: use topic summary from profile
            topics = leetcode_profile.get('topics', [])
            topic_proficiency = calculate_topic_proficiency_from_summary(topics)
        else:
            # Calculate proficiency from submissions (preferred method)
            topic_proficiency = calculate_topic_proficiency_from_submissions(submissions)
        
        # 3. Classify topics (weak/moderate/strong)
        classified_topics = classify_topics(topic_proficiency)
        
        # 4. Generate skill heatmap data structure
        heatmap_data = generate_skill_heatmap(classified_topics)
        
        # 5. Store analysis results in DynamoDB
        store_analysis_results(user_id, classified_topics, heatmap_data)
        
        # 6. Publish ProfileAnalysisComplete event to EventBridge
        publish_analysis_complete_event(user_id, classified_topics)
        
        return {
            'statusCode': 200,
            'headers': get_cors_headers(),
            'body': json.dumps({
                'message': 'Profile analysis complete',
                'user_id': user_id,
                'topics': classified_topics,
                'heatmap': heatmap_data,
                'summary': {
                    'total_topics': len(classified_topics),
                    'weak_topics': len([t for t in classified_topics.values() if t['classification'] == 'weak']),
                    'moderate_topics': len([t for t in classified_topics.values() if t['classification'] == 'moderate']),
                    'strong_topics': len([t for t in classified_topics.values() if t['classification'] == 'strong'])
                }
            })
        }
    
    except Exception as e:
        print(f"Error analyzing profile: {str(e)}")
        return {
            'statusCode': 500,
            'headers': get_cors_headers(),
            'body': json.dumps({
                'error': 'Failed to analyze profile',
                'details': str(e)
            })
        }
def handle_get_topics(user_id: str) -> Dict[str, Any]:
    """
    Get topic proficiency breakdown for a user
    """
    
    if not user_id:
        return {
            'statusCode': 400,
            'headers': get_cors_headers(),
            'body': json.dumps({'error': 'Missing user_id'})
        }
    
    try:
        # Fetch user data from DynamoDB
        user_data = fetch_user_profile(user_id)
        
        if not user_data:
            return {
                'statusCode': 404,
                'headers': get_cors_headers(),
                'body': json.dumps({'error': 'User not found'})
            }
        
        # Get topic proficiency from stored analysis
        leetcode_profile = user_data.get('leetcode_profile', {})
        topic_proficiency = leetcode_profile.get('topic_proficiency', {})
        
        return {
            'statusCode': 200,
            'headers': get_cors_headers(),
            'body': json.dumps({
                'user_id': user_id,
                'topics': topic_proficiency
            })
        }
    
    except Exception as e:
        print(f"Error fetching topics: {str(e)}")
        return {
            'statusCode': 500,
            'headers': get_cors_headers(),
            'body': json.dumps({
                'error': 'Failed to fetch topics',
                'details': str(e)
            })
        }
def handle_sync(user_id: str) -> Dict[str, Any]:
    """
    Trigger manual sync with LeetCode
    """
    
    if not user_id:
        return {
            'statusCode': 400,
            'headers': get_cors_headers(),
            'body': json.dumps({'error': 'Missing user_id'})
        }
    
    # TODO: Trigger scraping and analysis
    
    return {
        'statusCode': 202,
        'headers': get_cors_headers(),
        'body': json.dumps({
            'message': 'Sync initiated (placeholder)',
            'user_id': user_id
        })
    }


def get_cors_headers() -> Dict[str, str]:
    """Return CORS headers for API responses"""
    return {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Request-ID',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
    }


# Helper functions for profile analysis
def fetch_user_profile(user_id: str) -> Dict[str, Any]:
    """
    Fetch user profile from DynamoDB Users table
    """
    try:
        response = users_table.get_item(Key={'user_id': user_id})
        return response.get('Item')
    except Exception as e:
        print(f"Error fetching user profile: {str(e)}")
        return None
def calculate_topic_proficiency_from_submissions(submissions: List[Dict[str, Any]]) -> Dict[str, float]:
    """
    Calculate proficiency for each topic based on submission history
    
    Formula: proficiency = (solved / attempted) × 100
    
    Args:
        submissions: List of submission dictionaries with 'title_slug' and 'status' fields
    
    Returns: {topic_slug: proficiency_score (0-100)}
    
    Note: This requires problem metadata to map problems to topics.
    If topic data is not available in submissions, this will return empty dict.
    """
    from collections import defaultdict
    
    topic_stats = defaultdict(lambda: {"solved": 0, "attempted": 0})
    
    for submission in submissions:
        # Get topics for this submission
        # Topics can be provided in the submission data or need to be fetched separately
        topics = submission.get('topics', [])
        status = submission.get('status', submission.get('statusDisplay', ''))
        
        # If no topics in submission, skip (we'll use fallback method)
        if not topics:
            continue
        
        # Count this submission for each topic
        for topic in topics:
            # Handle both string topics and dict topics
            if isinstance(topic, dict):
                topic_slug = topic.get('slug', topic.get('tagSlug', topic.get('name', '')))
            else:
                topic_slug = topic
            
            if topic_slug:
                topic_stats[topic_slug]["attempted"] += 1
                if status == "Accepted" or status == "AC":
                    topic_stats[topic_slug]["solved"] += 1
    
    # Calculate proficiency for each topic
    topic_proficiency = {}
    for topic, stats in topic_stats.items():
        if stats["attempted"] > 0:
            proficiency = (stats["solved"] / stats["attempted"]) * 100
            topic_proficiency[topic] = round(proficiency, 2)
    
    return topic_proficiency
def calculate_topic_proficiency_from_summary(topics: List[Dict[str, Any]]) -> Dict[str, float]:
    """
    Calculate proficiency for each topic based on profile summary data (fallback method)
    
    This is used when submission history is not available.
    Uses a heuristic based on problems_solved count and topic level.
    
    Args:
        topics: List of topic dictionaries from LeetCode profile
    
    Returns: {topic_slug: proficiency_score (0-100)}
    """
    topic_proficiency = {}
    
    for topic in topics:
        topic_slug = topic.get('slug', '')
        problems_solved = topic.get('problems_solved', 0)
        level = topic.get('level', 'fundamental')
        
        # Estimate proficiency based on problems solved and level
        # Advanced topics: 5+ problems = strong, 2-4 = moderate, <2 = weak
        # Intermediate: 8+ = strong, 3-7 = moderate, <3 = weak
        # Fundamental: 10+ = strong, 4-9 = moderate, <4 = weak
        
        if level == 'advanced':
            if problems_solved >= 5:
                proficiency = min(100, 70 + (problems_solved - 5) * 5)
            elif problems_solved >= 2:
                proficiency = 40 + (problems_solved - 2) * 10
            else:
                proficiency = problems_solved * 20
        elif level == 'intermediate':
            if problems_solved >= 8:
                proficiency = min(100, 70 + (problems_solved - 8) * 3)
            elif problems_solved >= 3:
                proficiency = 40 + (problems_solved - 3) * 6
            else:
                proficiency = problems_solved * 13
        else:  # fundamental
            if problems_solved >= 10:
                proficiency = min(100, 70 + (problems_solved - 10) * 2)
            elif problems_solved >= 4:
                proficiency = 40 + (problems_solved - 4) * 5
            else:
                proficiency = problems_solved * 10
        
        topic_proficiency[topic_slug] = round(proficiency, 2)
    
    return topic_proficiency
def classify_topics(topic_proficiency: Dict[str, float]) -> Dict[str, Dict[str, Any]]:
    """
    Classify topics as weak (<40%), moderate (40-70%), or strong (>70%)
    
    Returns: {topic: {proficiency: float, classification: str}}
    """
    classified = {}
    
    for topic, proficiency in topic_proficiency.items():
        if proficiency < 40:
            classification = 'weak'
        elif proficiency <= 70:
            classification = 'moderate'
        else:
            classification = 'strong'
        
        classified[topic] = {
            'proficiency': proficiency,
            'classification': classification
        }
    
    return classified
def generate_skill_heatmap(classified_topics: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    """
    Generate skill heatmap data structure for frontend visualization
    
    Returns a structure suitable for D3.js or Recharts heatmap
    """
    # Group topics by classification
    weak_topics = []
    moderate_topics = []
    strong_topics = []
    
    for topic, data in classified_topics.items():
        topic_data = {
            'name': topic,
            'proficiency': data['proficiency']
        }
        
        if data['classification'] == 'weak':
            weak_topics.append(topic_data)
        elif data['classification'] == 'moderate':
            moderate_topics.append(topic_data)
        else:
            strong_topics.append(topic_data)
    
    # Sort by proficiency within each group
    weak_topics.sort(key=lambda x: x['proficiency'])
    moderate_topics.sort(key=lambda x: x['proficiency'])
    strong_topics.sort(key=lambda x: x['proficiency'], reverse=True)
    
    # Create heatmap data structure
    heatmap = {
        'weak': weak_topics,
        'moderate': moderate_topics,
        'strong': strong_topics,
        'all_topics': [
            {
                'name': topic,
                'proficiency': data['proficiency'],
                'classification': data['classification']
            }
            for topic, data in sorted(
                classified_topics.items(),
                key=lambda x: x[1]['proficiency'],
                reverse=True
            )
        ]
    }
    
    return heatmap
def store_analysis_results(
    user_id: str,
    classified_topics: Dict[str, Dict[str, Any]],
    heatmap_data: Dict[str, Any]
):
    """
    Store analysis results in DynamoDB Users table
    """
    try:
        users_table.update_item(
            Key={'user_id': user_id},
            UpdateExpression='SET leetcode_profile.topic_proficiency = :topics, '
                           'leetcode_profile.heatmap_data = :heatmap, '
                           'leetcode_profile.last_analyzed = :timestamp',
            ExpressionAttributeValues={
                ':topics': classified_topics,
                ':heatmap': heatmap_data,
                ':timestamp': datetime.now(timezone.utc).isoformat()
            }
        )
        print(f"Stored analysis results for user {user_id}")
    except Exception as e:
        print(f"Error storing analysis results: {str(e)}")
        raise
def publish_analysis_complete_event(
    user_id: str,
    classified_topics: Dict[str, Dict[str, Any]]
):
    """
    Publish ProfileAnalysisComplete event to EventBridge
    """
    # Extract weak topics for event payload
    weak_topics = [
        topic for topic, data in classified_topics.items()
        if data['classification'] == 'weak'
    ]
    
    strong_topics = [
        topic for topic, data in classified_topics.items()
        if data['classification'] == 'strong'
    ]
    
    try:
        event_bus_name = os.environ.get('EVENT_BUS_NAME', 'codeflow-events')
        
        events_client.put_events(
            Entries=[
                {
                    'Source': 'codeflow.analysis',
                    'DetailType': 'ProfileAnalysisComplete',
                    'Detail': json.dumps({
                        'user_id': user_id,
                        'weak_topics': weak_topics,
                        'strong_topics': strong_topics,
                        'total_topics': len(classified_topics),
                        'timestamp': datetime.now(timezone.utc).isoformat()
                    }),
                    'EventBusName': event_bus_name
                }
            ]
        )
        print(f"Published ProfileAnalysisComplete event for user {user_id}")
    except Exception as e:
        print(f"Error publishing event: {str(e)}")
        # Don't fail the request if event publishing fails
def handle_get_progress(user_id: str) -> Dict[str, Any]:
    """
    Get user progress including streak, badges, and problems solved
    
    This endpoint:
    1. Fetches current progress from DynamoDB Progress table
    2. Checks if streak should be reset (if >24h since last solve)
    3. Returns current streak, badges, and daily stats
    
    Args:
        user_id: User ID
    
    Returns:
        API Gateway response with progress data
    """
    
    if not user_id:
        return {
            'statusCode': 400,
            'headers': get_cors_headers(),
            'body': json.dumps({'error': 'Missing user_id'})
        }
    
    try:
        # Fetch current progress from DynamoDB
        progress_data = fetch_user_progress(user_id)
        
        if not progress_data:
            # User has no progress yet - return initial state
            return {
                'statusCode': 200,
                'headers': get_cors_headers(),
                'body': json.dumps({
                    'user_id': user_id,
                    'streak_count': 0,
                    'badges': [],
                    'problems_solved_today': 0,
                    'total_problems_solved': 0,
                    'last_solve_timestamp': None,
                    'message': 'No progress data yet. Start solving problems!'
                })
            }
        
        # Get current values
        current_streak = progress_data.get('streak_count', 0)
        last_solve_timestamp_str = progress_data.get('last_solve_timestamp')
        badges = progress_data.get('badges', [])
        problems_solved_today = progress_data.get('problems_solved_today', 0)
        total_problems_solved = progress_data.get('total_problems_solved', 0)
        
        # Check if streak should be reset (if >24h since last solve)
        if last_solve_timestamp_str and current_streak > 0:
            # Parse timestamp
            if isinstance(last_solve_timestamp_str, str):
                last_solve_timestamp = datetime.fromisoformat(last_solve_timestamp_str.replace('Z', '+00:00'))
            else:
                last_solve_timestamp = last_solve_timestamp_str
            
            # Check for streak reset
            now = datetime.now(timezone.utc)
            updated_streak = check_streak_reset(current_streak, last_solve_timestamp, now)
            
            # If streak was reset, update in DynamoDB
            if updated_streak != current_streak:
                update_streak_in_db(user_id, updated_streak)
                current_streak = updated_streak
        
        # Format badges for response
        formatted_badges = []
        for badge in badges:
            if isinstance(badge, dict):
                formatted_badges.append({
                    'badge_id': badge.get('badge_id'),
                    'name': badge.get('name'),
                    'earned_at': badge.get('earned_at'),
                    'milestone': badge.get('milestone')
                })
        
        # Calculate next milestone
        next_milestone = None
        for milestone in sorted(MILESTONE_BADGES.keys()):
            if current_streak < milestone:
                next_milestone = {
                    'days': milestone,
                    'badge_name': f"{milestone} Day Streak",
                    'days_remaining': milestone - current_streak
                }
                break
        
        return {
            'statusCode': 200,
            'headers': get_cors_headers(),
            'body': json.dumps({
                'user_id': user_id,
                'streak_count': current_streak,
                'badges': formatted_badges,
                'problems_solved_today': problems_solved_today,
                'total_problems_solved': total_problems_solved,
                'last_solve_timestamp': last_solve_timestamp_str,
                'next_milestone': next_milestone
            })
        }
    
    except Exception as e:
        print(f"Error fetching progress: {str(e)}")
        import traceback
        traceback.print_exc()
        return {
            'statusCode': 500,
            'headers': get_cors_headers(),
            'body': json.dumps({
                'error': 'Failed to fetch progress',
                'details': str(e)
            })
        }
def fetch_user_progress(user_id: str) -> Dict[str, Any]:
    """
    Fetch user progress from DynamoDB Progress table
    
    The Progress table uses a composite key: user_id#date
    We need to query for the most recent progress entry for this user
    
    Args:
        user_id: User ID
    
    Returns:
        Progress data or None if not found
    """
    try:
        # Query Progress table using GSI on user_id
        # This assumes there's a GSI with user_id as partition key
        response = progress_table.query(
            IndexName='user_id-index',
            KeyConditionExpression='user_id = :user_id',
            ExpressionAttributeValues={
                ':user_id': user_id
            },
            ScanIndexForward=False,  # Sort descending (most recent first)
            Limit=1
        )
        
        items = response.get('Items', [])
        if items:
            return items[0]
        
        return None
    
    except Exception as e:
        print(f"Error fetching user progress: {str(e)}")
        # If GSI doesn't exist, try getting from Users table as fallback
        try:
            user_data = users_table.get_item(Key={'user_id': user_id})
            user_item = user_data.get('Item')
            if user_item and 'progress' in user_item:
                return user_item['progress']
        except Exception as fallback_error:
            print(f"Fallback fetch also failed: {str(fallback_error)}")
        
        return None
def update_streak_in_db(user_id: str, new_streak: int):
    """
    Update streak count in DynamoDB when it's reset
    
    Args:
        user_id: User ID
        new_streak: New streak count (typically 0 when reset)
    """
    try:
        # Update the most recent progress entry
        today = datetime.now(timezone.utc).date().isoformat()
        progress_id = f"{user_id}#{today}"
        
        progress_table.update_item(
            Key={'progress_id': progress_id},
            UpdateExpression='SET streak_count = :streak',
            ExpressionAttributeValues={
                ':streak': new_streak
            }
        )
        print(f"Updated streak for user {user_id} to {new_streak}")
    
    except Exception as e:
        print(f"Error updating streak: {str(e)}")
        # Non-critical error, don't fail the request



# Admin Analytics Functions

def check_admin_auth(headers: Dict[str, str]) -> bool:
    """
    Check if request has valid admin authentication
    
    For now, checks for X-Api-Key header matching admin API key from environment.
    In production, this should use more robust authentication (e.g., Cognito admin group).
    
    Args:
        headers: Request headers
    
    Returns:
        True if authenticated as admin, False otherwise
    """
    admin_api_key = os.environ.get('ADMIN_API_KEY', '')
    
    # Check for X-Api-Key header (case-insensitive)
    api_key = None
    for header_name, header_value in headers.items():
        if header_name.lower() == 'x-api-key':
            api_key = header_value
            break
    
    if not api_key or not admin_api_key:
        return False
    
    return api_key == admin_api_key
def handle_admin_dau(headers: Dict[str, str]) -> Dict[str, Any]:
    """
    Get Daily/Weekly/Monthly Active Users (DAU/WAU/MAU)
    
    Admin-only endpoint that calculates:
    - DAU: Unique users active in last 24 hours
    - WAU: Unique users active in last 7 days
    - MAU: Unique users active in last 30 days
    
    Args:
        headers: Request headers for authentication
    
    Returns:
        API Gateway response with DAU/WAU/MAU metrics
    """
    
    # Check admin authentication
    if not check_admin_auth(headers):
        return {
            'statusCode': 403,
            'headers': get_cors_headers(),
            'body': json.dumps({'error': 'Forbidden: Admin access required'})
        }
    
    try:
        from datetime import timedelta
        
        now = datetime.now(timezone.utc)
        today = now.date().isoformat()
        
        # Calculate date ranges
        yesterday = (now - timedelta(days=1)).date().isoformat()
        week_ago = (now - timedelta(days=7)).date().isoformat()
        month_ago = (now - timedelta(days=30)).date().isoformat()
        
        # Fetch DAU metric from Analytics table
        dau_response = analytics_table.get_item(
            Key={'date': today, 'metric_type': 'DAU'}
        )
        dau_item = dau_response.get('Item')
        dau = int(dau_item.get('value', 0)) if dau_item else 0
        
        # Fetch WAU metric from Analytics table
        wau_response = analytics_table.get_item(
            Key={'date': today, 'metric_type': 'WAU'}
        )
        wau_item = wau_response.get('Item')
        wau = int(wau_item.get('value', 0)) if wau_item else 0
        
        # Fetch MAU metric from Analytics table
        mau_response = analytics_table.get_item(
            Key={'date': today, 'metric_type': 'MAU'}
        )
        mau_item = mau_response.get('Item')
        mau = int(mau_item.get('value', 0)) if mau_item else 0
        
        # If metrics don't exist for today, calculate from Progress table
        if dau == 0 or wau == 0 or mau == 0:
            calculated_metrics = calculate_active_users_from_progress(today, week_ago, month_ago)
            if dau == 0:
                dau = calculated_metrics['dau']
            if wau == 0:
                wau = calculated_metrics['wau']
            if mau == 0:
                mau = calculated_metrics['mau']
        
        # Fetch API response times and error rates
        api_metrics = get_api_metrics(today)
        
        return {
            'statusCode': 200,
            'headers': get_cors_headers(),
            'body': json.dumps({
                'date': today,
                'dau': dau,
                'wau': wau,
                'mau': mau,
                'api_metrics': api_metrics,
                'timestamp': now.isoformat()
            })
        }
    
    except Exception as e:
        print(f"Error fetching DAU metrics: {str(e)}")
        import traceback
        traceback.print_exc()
        return {
            'statusCode': 500,
            'headers': get_cors_headers(),
            'body': json.dumps({
                'error': 'Failed to fetch DAU metrics',
                'details': str(e)
            })
        }
def handle_admin_retention(headers: Dict[str, str]) -> Dict[str, Any]:
    """
    Get user retention metrics
    
    Admin-only endpoint that calculates:
    - Day 1 retention: % of users who return the next day
    - Day 7 retention: % of users who return after 7 days
    - Day 30 retention: % of users who return after 30 days
    
    Args:
        headers: Request headers for authentication
    
    Returns:
        API Gateway response with retention metrics
    """
    
    # Check admin authentication
    if not check_admin_auth(headers):
        return {
            'statusCode': 403,
            'headers': get_cors_headers(),
            'body': json.dumps({'error': 'Forbidden: Admin access required'})
        }
    
    try:
        from datetime import timedelta
        
        now = datetime.now(timezone.utc)
        today = now.date().isoformat()
        
        # Fetch retention metrics from Analytics table
        retention_1d_response = analytics_table.get_item(
            Key={'date': today, 'metric_type': 'RETENTION_1D'}
        )
        retention_1d_item = retention_1d_response.get('Item')
        retention_1d = float(retention_1d_item.get('value', 0)) if retention_1d_item else 0
        
        retention_7d_response = analytics_table.get_item(
            Key={'date': today, 'metric_type': 'RETENTION_7D'}
        )
        retention_7d_item = retention_7d_response.get('Item')
        retention_7d = float(retention_7d_item.get('value', 0)) if retention_7d_item else 0
        
        retention_30d_response = analytics_table.get_item(
            Key={'date': today, 'metric_type': 'RETENTION_30D'}
        )
        retention_30d_item = retention_30d_response.get('Item')
        retention_30d = float(retention_30d_item.get('value', 0)) if retention_30d_item else 0
        
        # If metrics don't exist for today, calculate from Progress table
        if retention_1d == 0 or retention_7d == 0 or retention_30d == 0:
            calculated_retention = calculate_retention_from_progress(today)
            if retention_1d == 0:
                retention_1d = calculated_retention['retention_1d']
            if retention_7d == 0:
                retention_7d = calculated_retention['retention_7d']
            if retention_30d == 0:
                retention_30d = calculated_retention['retention_30d']
        
        return {
            'statusCode': 200,
            'headers': get_cors_headers(),
            'body': json.dumps({
                'date': today,
                'retention_1d': round(retention_1d, 2),
                'retention_7d': round(retention_7d, 2),
                'retention_30d': round(retention_30d, 2),
                'timestamp': now.isoformat()
            })
        }
    
    except Exception as e:
        print(f"Error fetching retention metrics: {str(e)}")
        import traceback
        traceback.print_exc()
        return {
            'statusCode': 500,
            'headers': get_cors_headers(),
            'body': json.dumps({
                'error': 'Failed to fetch retention metrics',
                'details': str(e)
            })
        }
def calculate_active_users_from_progress(today: str, week_ago: str, month_ago: str) -> Dict[str, int]:
    """
    Calculate DAU/WAU/MAU from Progress table
    
    This is a fallback when Analytics table doesn't have pre-calculated metrics.
    
    Args:
        today: Today's date in ISO format
        week_ago: Date 7 days ago in ISO format
        month_ago: Date 30 days ago in ISO format
    
    Returns:
        Dictionary with dau, wau, mau counts
    """
    try:
        # Scan Progress table to count unique users
        # Note: In production, this should use a more efficient approach (e.g., GSI query)
        
        # For DAU: count unique users with activity today
        dau_users = set()
        
        # For WAU: count unique users with activity in last 7 days
        wau_users = set()
        
        # For MAU: count unique users with activity in last 30 days
        mau_users = set()
        
        # Scan Progress table (limited scan for performance)
        # In production, this should be pre-calculated and stored in Analytics table
        response = progress_table.scan(
            Limit=1000  # Limit to prevent timeout
        )
        
        items = response.get('Items', [])
        
        for item in items:
            user_id = item.get('user_id')
            progress_id = item.get('progress_id', '')
            
            # Extract date from progress_id (format: user_id#date)
            if '#' in progress_id:
                date_part = progress_id.split('#')[1]
                
                # Check if user was active today
                if date_part == today:
                    dau_users.add(user_id)
                
                # Check if user was active in last 7 days
                if date_part >= week_ago:
                    wau_users.add(user_id)
                
                # Check if user was active in last 30 days
                if date_part >= month_ago:
                    mau_users.add(user_id)
        
        return {
            'dau': len(dau_users),
            'wau': len(wau_users),
            'mau': len(mau_users)
        }
    
    except Exception as e:
        print(f"Error calculating active users: {str(e)}")
        return {'dau': 0, 'wau': 0, 'mau': 0}
def calculate_retention_from_progress(today: str) -> Dict[str, float]:
    """
    Calculate retention metrics from Progress table
    
    This is a fallback when Analytics table doesn't have pre-calculated metrics.
    
    Args:
        today: Today's date in ISO format
    
    Returns:
        Dictionary with retention_1d, retention_7d, retention_30d percentages
    """
    try:
        from datetime import timedelta, date
        
        # Parse today's date
        today_date = date.fromisoformat(today)
        
        # Calculate cohort dates
        day_1_cohort = (today_date - timedelta(days=1)).isoformat()
        day_7_cohort = (today_date - timedelta(days=7)).isoformat()
        day_30_cohort = (today_date - timedelta(days=30)).isoformat()
        
        # Scan Progress table to calculate retention
        # Note: This is a simplified calculation for MVP
        # In production, use pre-calculated metrics in Analytics table
        
        response = progress_table.scan(
            Limit=1000  # Limit to prevent timeout
        )
        
        items = response.get('Items', [])
        
        # Track users by cohort
        day_1_cohort_users = set()
        day_1_returned_users = set()
        
        day_7_cohort_users = set()
        day_7_returned_users = set()
        
        day_30_cohort_users = set()
        day_30_returned_users = set()
        
        for item in items:
            user_id = item.get('user_id')
            progress_id = item.get('progress_id', '')
            
            if '#' in progress_id:
                date_part = progress_id.split('#')[1]
                
                # Day 1 retention: users from yesterday who returned today
                if date_part == day_1_cohort:
                    day_1_cohort_users.add(user_id)
                elif date_part == today and user_id in day_1_cohort_users:
                    day_1_returned_users.add(user_id)
                
                # Day 7 retention: users from 7 days ago who returned today
                if date_part == day_7_cohort:
                    day_7_cohort_users.add(user_id)
                elif date_part == today and user_id in day_7_cohort_users:
                    day_7_returned_users.add(user_id)
                
                # Day 30 retention: users from 30 days ago who returned today
                if date_part == day_30_cohort:
                    day_30_cohort_users.add(user_id)
                elif date_part == today and user_id in day_30_cohort_users:
                    day_30_returned_users.add(user_id)
        
        # Calculate retention percentages
        retention_1d = (len(day_1_returned_users) / len(day_1_cohort_users) * 100) if day_1_cohort_users else 0
        retention_7d = (len(day_7_returned_users) / len(day_7_cohort_users) * 100) if day_7_cohort_users else 0
        retention_30d = (len(day_30_returned_users) / len(day_30_cohort_users) * 100) if day_30_cohort_users else 0
        
        return {
            'retention_1d': retention_1d,
            'retention_7d': retention_7d,
            'retention_30d': retention_30d
        }
    
    except Exception as e:
        print(f"Error calculating retention: {str(e)}")
        return {'retention_1d': 0, 'retention_7d': 0, 'retention_30d': 0}
def get_api_metrics(today: str) -> Dict[str, Any]:
    """
    Get API response times and error rates from Analytics table
    
    Args:
        today: Today's date in ISO format
    
    Returns:
        Dictionary with API metrics
    """
    try:
        # Fetch API response time metrics
        response_time_response = analytics_table.get_item(
            Key={'date': today, 'metric_type': 'API_RESPONSE_TIME'}
        )
        response_time_item = response_time_response.get('Item')
        
        if response_time_item:
            metadata = response_time_item.get('metadata', {})
            avg_response_time = metadata.get('avg_ms', 0)
            p95_response_time = metadata.get('p95_ms', 0)
            p99_response_time = metadata.get('p99_ms', 0)
        else:
            avg_response_time = 0
            p95_response_time = 0
            p99_response_time = 0
        
        # Fetch API error rate metrics
        error_rate_response = analytics_table.get_item(
            Key={'date': today, 'metric_type': 'API_ERROR_RATE'}
        )
        error_rate_item = error_rate_response.get('Item')
        
        if error_rate_item:
            error_rate = float(error_rate_item.get('value', 0))
            metadata = error_rate_item.get('metadata', {})
            total_requests = metadata.get('total_requests', 0)
            error_count = metadata.get('error_count', 0)
        else:
            error_rate = 0
            total_requests = 0
            error_count = 0
        
        return {
            'response_time': {
                'avg_ms': round(avg_response_time, 2),
                'p95_ms': round(p95_response_time, 2),
                'p99_ms': round(p99_response_time, 2)
            },
            'error_rate': {
                'percentage': round(error_rate, 2),
                'total_requests': total_requests,
                'error_count': error_count
            }
        }
    
    except Exception as e:
        print(f"Error fetching API metrics: {str(e)}")
        return {
            'response_time': {'avg_ms': 0, 'p95_ms': 0, 'p99_ms': 0},
            'error_rate': {'percentage': 0, 'total_requests': 0, 'error_count': 0}
        }

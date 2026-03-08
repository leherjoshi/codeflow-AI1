"""
Integration test for profile analysis service
Tests the complete flow from API request to DynamoDB storage
"""

import pytest
from unittest.mock import Mock, patch, MagicMock
import json
import os

# Set environment variables
os.environ['USERS_TABLE'] = 'test-users-table'
os.environ['PROGRESS_TABLE'] = 'test-progress-table'
os.environ['ANALYTICS_TABLE'] = 'test-analytics-table'
os.environ['EVENT_BUS_NAME'] = 'test-event-bus'
os.environ['AWS_DEFAULT_REGION'] = 'us-east-1'


@pytest.fixture
def mock_dynamodb():
    """Mock DynamoDB tables"""
    with patch('index.users_table') as mock_users, \
         patch('index.progress_table') as mock_progress, \
         patch('index.analytics_table') as mock_analytics:
        yield {
            'users': mock_users,
            'progress': mock_progress,
            'analytics': mock_analytics
        }


@pytest.fixture
def mock_events():
    """Mock EventBridge client"""
    with patch('index.events_client') as mock_events:
        yield mock_events


@pytest.fixture
def sample_profile_data():
    """Sample LeetCode profile data - returns a fresh copy each time"""
    def _get_sample_data():
        return {
            'user_id': 'test-user-123',
            'leetcode_username': 'testuser',
            'leetcode_profile': {
                'username': 'testuser',
                'total_solved': 150,
                'easy_solved': 60,
                'medium_solved': 70,
                'hard_solved': 20,
                'topics': [
                    {'slug': 'arrays', 'problems_solved': 25, 'level': 'fundamental'},
                    {'slug': 'strings', 'problems_solved': 20, 'level': 'fundamental'},
                    {'slug': 'dynamic-programming', 'problems_solved': 3, 'level': 'advanced'},
                    {'slug': 'graphs', 'problems_solved': 8, 'level': 'intermediate'},
                    {'slug': 'binary-search', 'problems_solved': 12, 'level': 'intermediate'},
                    {'slug': 'trees', 'problems_solved': 15, 'level': 'intermediate'},
                    {'slug': 'backtracking', 'problems_solved': 1, 'level': 'advanced'},
                    {'slug': 'trie', 'problems_solved': 0, 'level': 'advanced'}
                ]
            }
        }
    return _get_sample_data()


def test_complete_analysis_flow(mock_dynamodb, mock_events, sample_profile_data):
    """Test complete profile analysis flow"""
    # Import after mocking
    from index import handler
    
    # Mock DynamoDB get_item to return sample profile
    mock_dynamodb['users'].get_item.return_value = {'Item': sample_profile_data}
    
    # Create API Gateway event
    event = {
        'httpMethod': 'POST',
        'path': '/api/v1/analysis/profile',
        'body': json.dumps({
            'user_id': 'test-user-123',
            'leetcode_username': 'testuser'
        })
    }
    
    # Call handler
    response = handler(event, None)
    
    # Verify response
    assert response['statusCode'] == 200
    body = json.loads(response['body'])
    
    # Verify response structure
    assert 'message' in body
    assert 'topics' in body
    assert 'heatmap' in body
    assert 'summary' in body
    
    # Verify topics are classified
    topics = body['topics']
    assert 'arrays' in topics
    assert 'dynamic-programming' in topics
    
    # Verify classifications
    assert topics['arrays']['classification'] == 'strong'  # 25 problems, fundamental
    assert topics['dynamic-programming']['classification'] == 'moderate'  # 3 problems, advanced
    assert topics['backtracking']['classification'] == 'weak'  # 1 problem, advanced
    
    # Verify heatmap structure
    heatmap = body['heatmap']
    assert 'weak' in heatmap
    assert 'moderate' in heatmap
    assert 'strong' in heatmap
    assert 'all_topics' in heatmap
    
    # Verify summary
    summary = body['summary']
    assert summary['total_topics'] == 8
    assert summary['weak_topics'] >= 1
    assert summary['moderate_topics'] >= 1
    assert summary['strong_topics'] >= 1
    
    # Verify DynamoDB update was called
    mock_dynamodb['users'].update_item.assert_called_once()
    update_call = mock_dynamodb['users'].update_item.call_args
    assert update_call[1]['Key'] == {'user_id': 'test-user-123'}
    
    # Verify EventBridge event was published
    mock_events.put_events.assert_called_once()
    event_call = mock_events.put_events.call_args
    entries = event_call[1]['Entries']
    assert len(entries) == 1
    assert entries[0]['Source'] == 'codeflow.analysis'
    assert entries[0]['DetailType'] == 'ProfileAnalysisComplete'
    
    # Verify event detail
    event_detail = json.loads(entries[0]['Detail'])
    assert event_detail['user_id'] == 'test-user-123'
    assert 'weak_topics' in event_detail
    assert 'strong_topics' in event_detail


def test_get_topics_endpoint(mock_dynamodb, mock_events, sample_profile_data):
    """Test GET /topics endpoint"""
    from index import handler
    
    # Reset mock to clear any previous calls
    mock_dynamodb['users'].reset_mock()
    mock_events.reset_mock()
    
    # Add topic proficiency to sample data (this is what gets stored after analysis)
    sample_profile_data['leetcode_profile']['topic_proficiency'] = {
        'arrays': {'proficiency': 85.0, 'classification': 'strong'},
        'dynamic-programming': {'proficiency': 35.0, 'classification': 'weak'}
    }
    
    mock_dynamodb['users'].get_item.return_value = {'Item': sample_profile_data}
    
    event = {
        'httpMethod': 'GET',
        'path': '/api/v1/analysis/test-user-123/topics',
        'pathParameters': {'user_id': 'test-user-123'}
    }
    
    response = handler(event, None)
    
    assert response['statusCode'] == 200
    body = json.loads(response['body'])
    assert 'topics' in body
    assert 'user_id' in body
    assert body['user_id'] == 'test-user-123'
    # Check that topics dict contains the expected keys
    assert 'arrays' in body['topics']
    assert 'dynamic-programming' in body['topics']
    # Verify the structure
    assert body['topics']['arrays']['proficiency'] == 85.0
    assert body['topics']['arrays']['classification'] == 'strong'


def test_error_handling_profile_not_found(mock_dynamodb, mock_events):
    """Test error handling when profile is not found"""
    from index import handler
    
    # Reset mock to clear any previous calls
    mock_dynamodb['users'].reset_mock()
    mock_events.reset_mock()
    
    # Mock DynamoDB to return no item (None)
    mock_dynamodb['users'].get_item.return_value = {}
    
    event = {
        'httpMethod': 'POST',
        'path': '/api/v1/analysis/profile',
        'body': json.dumps({
            'user_id': 'nonexistent-user',
            'leetcode_username': 'testuser'
        })
    }
    
    response = handler(event, None)
    
    assert response['statusCode'] == 404
    body = json.loads(response['body'])
    assert 'error' in body


if __name__ == '__main__':
    pytest.main([__file__, '-v'])



def test_get_progress_endpoint_with_data(mock_dynamodb, mock_events):
    """Test GET /progress endpoint with existing progress data"""
    from index import handler
    from datetime import datetime, timezone
    
    # Reset mocks
    mock_dynamodb['users'].reset_mock()
    mock_dynamodb['progress'].reset_mock()
    mock_events.reset_mock()
    
    # Mock progress data
    progress_data = {
        'progress_id': 'test-user-123#2024-01-15',
        'user_id': 'test-user-123',
        'streak_count': 5,
        'badges': [
            {
                'badge_id': '7-day-streak',
                'name': '7 Day Streak',
                'earned_at': '2024-01-10T12:00:00+00:00',
                'milestone': 7
            }
        ],
        'problems_solved_today': 3,
        'total_problems_solved': 42,
        'last_solve_timestamp': datetime.now(timezone.utc).isoformat()
    }
    
    # Mock DynamoDB query to return progress data
    mock_dynamodb['progress'].query.return_value = {'Items': [progress_data]}
    
    event = {
        'httpMethod': 'GET',
        'path': '/api/v1/progress/test-user-123',
        'pathParameters': {'user_id': 'test-user-123'}
    }
    
    response = handler(event, None)
    
    assert response['statusCode'] == 200
    body = json.loads(response['body'])
    
    # Verify response structure
    assert body['user_id'] == 'test-user-123'
    assert body['streak_count'] == 5
    assert body['problems_solved_today'] == 3
    assert body['total_problems_solved'] == 42
    assert len(body['badges']) == 1
    assert body['badges'][0]['badge_id'] == '7-day-streak'
    
    # Verify next milestone is calculated
    assert 'next_milestone' in body
    if body['next_milestone']:
        assert body['next_milestone']['days'] == 7  # Next milestone after 5 is 7
        assert body['next_milestone']['days_remaining'] == 2


def test_get_progress_endpoint_no_data(mock_dynamodb, mock_events):
    """Test GET /progress endpoint with no progress data (new user)"""
    from index import handler
    
    # Reset mocks
    mock_dynamodb['users'].reset_mock()
    mock_dynamodb['progress'].reset_mock()
    mock_events.reset_mock()
    
    # Mock DynamoDB query to return empty result
    mock_dynamodb['progress'].query.return_value = {'Items': []}
    
    event = {
        'httpMethod': 'GET',
        'path': '/api/v1/progress/new-user-456',
        'pathParameters': {'user_id': 'new-user-456'}
    }
    
    response = handler(event, None)
    
    assert response['statusCode'] == 200
    body = json.loads(response['body'])
    
    # Verify initial state
    assert body['user_id'] == 'new-user-456'
    assert body['streak_count'] == 0
    assert body['badges'] == []
    assert body['problems_solved_today'] == 0
    assert body['total_problems_solved'] == 0
    assert body['last_solve_timestamp'] is None
    assert 'message' in body


def test_get_progress_endpoint_streak_reset(mock_dynamodb, mock_events):
    """Test GET /progress endpoint with streak that should be reset (>24h)"""
    from index import handler
    from datetime import datetime, timezone, timedelta
    
    # Reset mocks
    mock_dynamodb['users'].reset_mock()
    mock_dynamodb['progress'].reset_mock()
    mock_events.reset_mock()
    
    # Mock progress data with old timestamp (>24h ago)
    old_timestamp = (datetime.now(timezone.utc) - timedelta(hours=30)).isoformat()
    progress_data = {
        'progress_id': 'test-user-789#2024-01-14',
        'user_id': 'test-user-789',
        'streak_count': 10,
        'badges': [],
        'problems_solved_today': 0,
        'total_problems_solved': 50,
        'last_solve_timestamp': old_timestamp
    }
    
    # Mock DynamoDB query to return progress data
    mock_dynamodb['progress'].query.return_value = {'Items': [progress_data]}
    
    event = {
        'httpMethod': 'GET',
        'path': '/api/v1/progress/test-user-789',
        'pathParameters': {'user_id': 'test-user-789'}
    }
    
    response = handler(event, None)
    
    assert response['statusCode'] == 200
    body = json.loads(response['body'])
    
    # Verify streak was reset to 0
    assert body['streak_count'] == 0
    
    # Verify update_item was called to persist the reset
    mock_dynamodb['progress'].update_item.assert_called_once()


def test_get_progress_missing_user_id(mock_dynamodb, mock_events):
    """Test GET /progress endpoint with missing user_id"""
    from index import handler
    
    # Reset mocks
    mock_dynamodb['users'].reset_mock()
    mock_dynamodb['progress'].reset_mock()
    mock_events.reset_mock()
    
    event = {
        'httpMethod': 'GET',
        'path': '/api/v1/progress/',
        'pathParameters': {}
    }
    
    response = handler(event, None)
    
    assert response['statusCode'] == 400
    body = json.loads(response['body'])
    assert 'error' in body

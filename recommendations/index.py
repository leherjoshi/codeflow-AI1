"""
Recommendations Lambda Function
Handles problem recommendations: Goldilocks algorithm, learning path generation, adaptive difficulty
"""

import json
import os
import hashlib
import uuid
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone, timedelta
import boto3

# Initialize AWS clients
dynamodb = boto3.resource('dynamodb')
bedrock_client = boto3.client('bedrock-runtime')

users_table = dynamodb.Table(os.environ['USERS_TABLE'])
learning_paths_table = dynamodb.Table(os.environ['LEARNING_PATHS_TABLE'])
progress_table = dynamodb.Table(os.environ['PROGRESS_TABLE'])
llm_cache_table = dynamodb.Table(os.environ['LLM_CACHE_TABLE'])

ENVIRONMENT = os.environ.get('ENVIRONMENT', 'dev')

# Import LLM cache
try:
    from llm_cache import LLMCache
except ImportError:
    print("Warning: LLM cache not available, will use direct Bedrock calls")
    LLMCache = None
def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Lambda handler for recommendation endpoints
    
    Supported operations:
    - POST /recommendations/generate-path: Generate learning path
    - GET /recommendations/next-problem: Get next recommended problem
    - POST /recommendations/hint: Generate hint for problem
    """
    
    try:
        http_method = event.get('httpMethod', '')
        path = event.get('path', '')
        body = json.loads(event.get('body', '{}')) if event.get('body') else {}
        query_parameters = event.get('queryStringParameters', {}) or {}
        
        # Handle OPTIONS request for CORS preflight
        if http_method == 'OPTIONS':
            return {
                'statusCode': 200,
                'headers': get_cors_headers(),
                'body': json.dumps({'message': 'CORS preflight successful'})
            }
        
        # Route to appropriate handler
        if http_method == 'POST' and '/generate-path' in path:
            return handle_generate_path(body)
        elif http_method == 'GET' and '/next-problem' in path:
            user_id = query_parameters.get('user_id')
            return handle_next_problem(user_id)
        elif http_method == 'POST' and '/hint' in path:
            return handle_generate_hint(body)
        else:
            return {
                'statusCode': 404,
                'headers': get_cors_headers(),
                'body': json.dumps({'error': 'Not found'})
            }
    
    except Exception as e:
        print(f"Error in recommendations handler: {str(e)}")
        return {
            'statusCode': 500,
            'headers': get_cors_headers(),
            'body': json.dumps({'error': 'Internal server error'})
        }
def handle_generate_path(body: Dict[str, Any]) -> Dict[str, Any]:
    """
    Generate personalized learning path using Bedrock
    
    Expected body:
    {
        "user_id": "string",
        "weak_topics": ["string"],
        "strong_topics": ["string"],
        "proficiency_level": "beginner|intermediate|advanced"
    }
    """
    
    user_id = body.get('user_id')
    weak_topics = body.get('weak_topics', [])
    strong_topics = body.get('strong_topics', [])
    proficiency_level = body.get('proficiency_level', 'intermediate')
    
    if not user_id:
        return {
            'statusCode': 400,
            'headers': get_cors_headers(),
            'body': json.dumps({'error': 'Missing user_id'})
        }
    
    try:
        # Generate learning path
        learning_path = generate_learning_path(
            user_id=user_id,
            weak_topics=weak_topics,
            strong_topics=strong_topics,
            proficiency_level=proficiency_level
        )
        
        return {
            'statusCode': 200,
            'headers': get_cors_headers(),
            'body': json.dumps(learning_path)
        }
    
    except Exception as e:
        print(f"Error generating learning path: {str(e)}")
        return {
            'statusCode': 500,
            'headers': get_cors_headers(),
            'body': json.dumps({
                'error': 'Failed to generate learning path',
                'details': str(e)
            })
        }
def generate_learning_path(
    user_id: str,
    weak_topics: List[str],
    strong_topics: List[str],
    proficiency_level: str
) -> Dict[str, Any]:
    """
    Generate personalized learning path using Bedrock Claude 3 Sonnet
    
    Requirements:
    - 20-30 problems
    - 70%+ problems target weak topics
    - Difficulty distribution: 30% Easy, 50% Medium, 20% Hard
    
    Args:
        user_id: User ID
        weak_topics: List of weak topics
        strong_topics: List of strong topics
        proficiency_level: User proficiency level
    
    Returns:
        Learning path dictionary with path_id and problems
    """
    
    # Build prompt for Bedrock
    prompt = build_learning_path_prompt(weak_topics, strong_topics, proficiency_level)
    
    # Check cache first
    cache_key = None
    cached_response = None
    
    if LLMCache:
        cache = LLMCache(os.environ['LLM_CACHE_TABLE'])
        cache_context = {
            'weak_topics': sorted(weak_topics[:5]),  # Top 5 for consistency
            'proficiency_level': proficiency_level
        }
        cache_key = cache.generate_cache_key(
            query=f"learning_path_{','.join(sorted(weak_topics[:5]))}",
            context=cache_context,
            model_id='claude-3-sonnet'
        )
        cached_response = cache.get(
            query=f"learning_path_{','.join(sorted(weak_topics[:5]))}",
            context=cache_context,
            model_id='claude-3-sonnet'
        )
    
    if cached_response:
        # Use cached response
        problems = json.loads(cached_response['response'])
        print(f"Cache hit for learning path generation")
    else:
        # Invoke Bedrock Claude 3 Sonnet (temperature 0.3 for analytical)
        response = invoke_bedrock_for_learning_path(prompt)
        problems = parse_learning_path_response(response)
        
        # Store in cache
        if LLMCache and cache:
            cache.set(
                query=f"learning_path_{','.join(sorted(weak_topics[:5]))}",
                response=json.dumps(problems),
                context=cache_context,
                model_id='claude-3-sonnet'
            )
    
    # Validate difficulty distribution
    validate_learning_path(problems)
    
    # Generate path ID and store in DynamoDB
    path_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    
    learning_paths_table.put_item(
        Item={
            'path_id': path_id,
            'user_id': user_id,
            'problems': problems,
            'weak_topics': weak_topics,
            'strong_topics': strong_topics,
            'proficiency_level': proficiency_level,
            'created_at': now.isoformat(),
            'current_index': 0,
            'completed_count': 0
        }
    )
    
    return {
        'path_id': path_id,
        'problems': problems,
        'total_problems': len(problems),
        'weak_topics_targeted': weak_topics,
        'created_at': now.isoformat()
    }
def build_learning_path_prompt(
    weak_topics: List[str],
    strong_topics: List[str],
    proficiency_level: str
) -> str:
    """
    Build prompt for learning path generation
    
    Args:
        weak_topics: List of weak topics
        strong_topics: List of strong topics
        proficiency_level: User proficiency level
    
    Returns:
        Formatted prompt for Bedrock
    """
    
    prompt = f"""You are an expert competitive programming mentor creating a personalized learning path.

User Profile:
- Proficiency Level: {proficiency_level}
- Weak Topics (need improvement): {', '.join(weak_topics) if weak_topics else 'None identified'}
- Strong Topics (already proficient): {', '.join(strong_topics) if strong_topics else 'None identified'}

Generate a learning path of 20-30 problems that follows these requirements:
1. Prioritize weak topics: At least 70% of problems should target weak topics
2. Difficulty distribution: 30% Easy, 50% Medium, 20% Hard
3. Logical progression: Start with easier concepts, build to harder ones
4. Include 2-3 problems per weak topic for practice
5. Mix in some strong topic problems to maintain confidence

Return ONLY a valid JSON array (no markdown, no explanation) with this exact format:
[
  {{
    "title": "Two Sum",
    "difficulty": "Easy",
    "topics": ["arrays", "hash-table"],
    "leetcode_id": "1",
    "estimated_time_minutes": 15,
    "reason": "Foundation for hash table usage"
  }}
]

Requirements:
- Each problem must have: title, difficulty (Easy/Medium/Hard), topics (array), leetcode_id, estimated_time_minutes, reason
- Total: 20-30 problems
- Weak topic problems: 70%+ of total
- Difficulty: 30% Easy, 50% Medium, 20% Hard
"""
    
    return prompt
def invoke_bedrock_for_learning_path(prompt: str) -> str:
    """
    Invoke Bedrock Claude 3 Sonnet for learning path generation
    
    Args:
        prompt: Formatted prompt
    
    Returns:
        Response text from Claude
    """
    
    try:
        # Use Nova Lite for learning path generation
        request_body = {
            "messages": [
                {
                    "role": "user",
                    "content": [{"text": prompt}]
                }
            ],
            "inferenceConfig": {
                "max_new_tokens": 4096,
                "temperature": 0.3  # Lower temperature for structured output
            }
        }
        
        response = bedrock_client.invoke_model(
            modelId='apac.amazon.nova-lite-v1:0',
            body=json.dumps(request_body)
        )
        
        response_body = json.loads(response['body'].read())
        
        # Extract text from Nova response format
        output = response_body.get('output', {})
        message = output.get('message', {})
        content = message.get('content', [])
        
        if content and len(content) > 0:
            return content[0].get('text', '')
        
        raise Exception("Empty response from Bedrock")
    
    except Exception as e:
        print(f"Error invoking Bedrock: {str(e)}")
        raise
def parse_learning_path_response(response: str) -> List[Dict[str, Any]]:
    """
    Parse Bedrock response into problem list
    
    Args:
        response: Raw response from Bedrock
    
    Returns:
        List of problem dictionaries
    """
    
    try:
        # Remove markdown code blocks if present
        response = response.strip()
        if response.startswith('```'):
            # Extract JSON from markdown code block
            lines = response.split('\n')
            response = '\n'.join(lines[1:-1])  # Remove first and last lines
        
        # Parse JSON
        problems = json.loads(response)
        
        if not isinstance(problems, list):
            raise ValueError("Response is not a list")
        
        # Validate each problem has required fields
        for problem in problems:
            required_fields = ['title', 'difficulty', 'topics', 'leetcode_id']
            for field in required_fields:
                if field not in problem:
                    raise ValueError(f"Problem missing required field: {field}")
        
        return problems
    
    except json.JSONDecodeError as e:
        print(f"Failed to parse JSON response: {str(e)}")
        print(f"Response: {response}")
        raise ValueError(f"Invalid JSON response from Bedrock: {str(e)}")
    except Exception as e:
        print(f"Error parsing learning path response: {str(e)}")
        raise
def validate_learning_path(problems: List[Dict[str, Any]]):
    """
    Validate learning path meets requirements
    
    Requirements:
    - 20-30 problems
    - Difficulty distribution: 30% Easy, 50% Medium, 20% Hard (±10% tolerance)
    
    Args:
        problems: List of problems
    
    Raises:
        ValueError if validation fails
    """
    
    total = len(problems)
    
    # Check total count
    if total < 20 or total > 30:
        raise ValueError(f"Learning path must have 20-30 problems, got {total}")
    
    # Count difficulties
    difficulty_counts = {'Easy': 0, 'Medium': 0, 'Hard': 0}
    for problem in problems:
        difficulty = problem.get('difficulty', '')
        if difficulty in difficulty_counts:
            difficulty_counts[difficulty] += 1
    
    # Calculate percentages
    easy_pct = (difficulty_counts['Easy'] / total) * 100
    medium_pct = (difficulty_counts['Medium'] / total) * 100
    hard_pct = (difficulty_counts['Hard'] / total) * 100
    
    print(f"Difficulty distribution: Easy={easy_pct:.1f}%, Medium={medium_pct:.1f}%, Hard={hard_pct:.1f}%")
    
    # Validate with ±10% tolerance
    if not (20 <= easy_pct <= 40):
        print(f"Warning: Easy percentage {easy_pct:.1f}% outside target range 30% ±10%")
    
    if not (40 <= medium_pct <= 60):
        print(f"Warning: Medium percentage {medium_pct:.1f}% outside target range 50% ±10%")
    
    if not (10 <= hard_pct <= 30):
        print(f"Warning: Hard percentage {hard_pct:.1f}% outside target range 20% ±10%")
def handle_next_problem(user_id: str) -> Dict[str, Any]:
    """
    Get next recommended problem using Goldilocks algorithm
    
    Goldilocks Algorithm:
    - Calculate recent success rate (last 10 problems)
    - Adjust difficulty based on performance:
      * Success ≥80% → increase difficulty
      * Success ≤40% → decrease difficulty
      * Otherwise → maintain current difficulty
    - Track consecutive failures (2+ → easier problem)
    """
    
    if not user_id:
        return {
            'statusCode': 400,
            'headers': get_cors_headers(),
            'body': json.dumps({'error': 'Missing user_id'})
        }
    
    try:
        # Get user's current learning path
        learning_path = get_current_learning_path(user_id)
        
        if not learning_path:
            return {
                'statusCode': 404,
                'headers': get_cors_headers(),
                'body': json.dumps({
                    'error': 'No learning path found',
                    'message': 'Please generate a learning path first'
                })
            }
        
        # Get recent performance
        recent_performance = get_recent_performance(user_id, limit=10)
        
        # Select next problem using Goldilocks algorithm
        next_problem = select_goldilocks_problem(
            learning_path=learning_path,
            recent_performance=recent_performance
        )
        
        if not next_problem:
            return {
                'statusCode': 200,
                'headers': get_cors_headers(),
                'body': json.dumps({
                    'message': 'Learning path completed!',
                    'completed': True
                })
            }
        
        return {
            'statusCode': 200,
            'headers': get_cors_headers(),
            'body': json.dumps({
                'problem': next_problem['problem'],
                'reason': next_problem['reason'],
                'current_index': next_problem['index'],
                'total_problems': len(learning_path['problems'])
            })
        }
    
    except Exception as e:
        print(f"Error getting next problem: {str(e)}")
        return {
            'statusCode': 500,
            'headers': get_cors_headers(),
            'body': json.dumps({
                'error': 'Failed to get next problem',
                'details': str(e)
            })
        }
def get_current_learning_path(user_id: str) -> Optional[Dict[str, Any]]:
    """
    Get user's current learning path from DynamoDB
    
    Args:
        user_id: User ID
    
    Returns:
        Learning path dictionary or None
    """
    
    try:
        # Query learning paths by user_id (using GSI)
        response = learning_paths_table.query(
            IndexName='user_id-index',
            KeyConditionExpression='user_id = :user_id',
            ExpressionAttributeValues={':user_id': user_id},
            ScanIndexForward=False,  # Most recent first
            Limit=1
        )
        
        items = response.get('Items', [])
        if items:
            return items[0]
        
        return None
    
    except Exception as e:
        print(f"Error getting learning path: {str(e)}")
        return None
def get_recent_performance(user_id: str, limit: int = 10) -> List[Dict[str, Any]]:
    """
    Get user's recent problem attempts
    
    Args:
        user_id: User ID
        limit: Number of recent attempts to fetch
    
    Returns:
        List of recent attempts with success status
    """
    
    try:
        # Query progress table by user_id
        response = progress_table.query(
            IndexName='user_id-index',
            KeyConditionExpression='user_id = :user_id',
            ExpressionAttributeValues={':user_id': user_id},
            ScanIndexForward=False,  # Most recent first
            Limit=limit
        )
        
        items = response.get('Items', [])
        
        # Extract success status
        performance = []
        for item in items:
            performance.append({
                'problem_id': item.get('problem_id'),
                'success': item.get('success', False),
                'difficulty': item.get('difficulty'),
                'timestamp': item.get('timestamp')
            })
        
        return performance
    
    except Exception as e:
        print(f"Error getting recent performance: {str(e)}")
        return []
def select_goldilocks_problem(
    learning_path: Dict[str, Any],
    recent_performance: List[Dict[str, Any]]
) -> Optional[Dict[str, Any]]:
    """
    Select next problem using Goldilocks algorithm
    
    Algorithm:
    1. Calculate recent success rate (last 10 problems)
    2. Adjust target difficulty:
       - Success ≥80% → increase difficulty
       - Success ≤40% → decrease difficulty
       - Otherwise → maintain current difficulty
    3. Check for consecutive failures (2+ → force easier problem)
    4. Select next unsolved problem matching target difficulty
    
    Args:
        learning_path: User's learning path
        recent_performance: Recent problem attempts
    
    Returns:
        Dictionary with problem and reason, or None if path completed
    """
    
    problems = learning_path.get('problems', [])
    current_index = learning_path.get('current_index', 0)
    
    # Get unsolved problems
    unsolved_problems = []
    for i, problem in enumerate(problems):
        if i >= current_index:
            unsolved_problems.append({'index': i, 'problem': problem})
    
    if not unsolved_problems:
        return None  # Path completed
    
    # Calculate recent success rate
    if recent_performance:
        successes = sum(1 for p in recent_performance if p.get('success', False))
        success_rate = successes / len(recent_performance)
    else:
        success_rate = 0.5  # Default to 50% if no history
    
    # Check for consecutive failures
    consecutive_failures = 0
    for perf in recent_performance:
        if not perf.get('success', False):
            consecutive_failures += 1
        else:
            break
    
    # Determine target difficulty
    current_difficulty = get_current_difficulty(recent_performance)
    
    if consecutive_failures >= 2:
        # Force easier problem after 2+ consecutive failures
        target_difficulty = decrease_difficulty(current_difficulty)
        reason = f"Adjusting to easier problems after {consecutive_failures} consecutive failures"
    elif success_rate >= 0.8:
        # High success rate → increase difficulty
        target_difficulty = increase_difficulty(current_difficulty)
        reason = f"Increasing difficulty (success rate: {success_rate*100:.0f}%)"
    elif success_rate <= 0.4:
        # Low success rate → decrease difficulty
        target_difficulty = decrease_difficulty(current_difficulty)
        reason = f"Decreasing difficulty (success rate: {success_rate*100:.0f}%)"
    else:
        # Maintain current difficulty
        target_difficulty = current_difficulty
        reason = f"Maintaining current difficulty (success rate: {success_rate*100:.0f}%)"
    
    # Find next problem matching target difficulty
    for item in unsolved_problems:
        if item['problem'].get('difficulty') == target_difficulty:
            return {
                'problem': item['problem'],
                'reason': reason,
                'index': item['index']
            }
    
    # Fallback: return next unsolved problem
    return {
        'problem': unsolved_problems[0]['problem'],
        'reason': f"{reason} (no {target_difficulty} problems available, continuing with next problem)",
        'index': unsolved_problems[0]['index']
    }
def get_current_difficulty(recent_performance: List[Dict[str, Any]]) -> str:
    """
    Get current difficulty level from recent performance
    
    Args:
        recent_performance: Recent problem attempts
    
    Returns:
        Difficulty level (Easy/Medium/Hard)
    """
    
    if not recent_performance:
        return 'Easy'
    
    # Use most recent problem's difficulty
    return recent_performance[0].get('difficulty', 'Easy')
def increase_difficulty(current: str) -> str:
    """
    Increase difficulty level
    
    Args:
        current: Current difficulty
    
    Returns:
        Next difficulty level
    """
    
    difficulty_map = {
        'Easy': 'Medium',
        'Medium': 'Hard',
        'Hard': 'Hard'  # Can't go higher
    }
    
    return difficulty_map.get(current, 'Medium')
def decrease_difficulty(current: str) -> str:
    """
    Decrease difficulty level
    
    Args:
        current: Current difficulty
    
    Returns:
        Previous difficulty level
    """
    
    difficulty_map = {
        'Easy': 'Easy',  # Can't go lower
        'Medium': 'Easy',
        'Hard': 'Medium'
    }
    
    return difficulty_map.get(current, 'Easy')
def handle_generate_hint(body: Dict[str, Any]) -> Dict[str, Any]:
    """
    Generate hint for a problem using Bedrock
    
    Requirements:
    - Code-free hints (no code snippets)
    - Progressive levels (1-3)
    - No explicit solutions
    
    Expected body:
    {
        "problem_id": "string",
        "problem_description": "string",
        "user_id": "string",
        "hint_level": 1|2|3
    }
    """
    
    problem_id = body.get('problem_id')
    problem_description = body.get('problem_description', '')
    user_id = body.get('user_id')
    hint_level = body.get('hint_level', 1)
    
    if not problem_id or not user_id:
        return {
            'statusCode': 400,
            'headers': get_cors_headers(),
            'body': json.dumps({'error': 'Missing required fields'})
        }
    
    if hint_level not in [1, 2, 3]:
        return {
            'statusCode': 400,
            'headers': get_cors_headers(),
            'body': json.dumps({'error': 'hint_level must be 1, 2, or 3'})
        }
    
    try:
        # Generate hint
        hint = generate_hint(
            problem_id=problem_id,
            problem_description=problem_description,
            hint_level=hint_level,
            user_id=user_id
        )
        
        return {
            'statusCode': 200,
            'headers': get_cors_headers(),
            'body': json.dumps({
                'hint': hint,
                'hint_level': hint_level,
                'problem_id': problem_id
            })
        }
    
    except Exception as e:
        print(f"Error generating hint: {str(e)}")
        return {
            'statusCode': 500,
            'headers': get_cors_headers(),
            'body': json.dumps({
                'error': 'Failed to generate hint',
                'details': str(e)
            })
        }
def generate_hint(
    problem_id: str,
    problem_description: str,
    hint_level: int,
    user_id: str
) -> str:
    """
    Generate progressive hint using Bedrock
    
    Hint Levels:
    1. High-level approach/key insight
    2. Data structure suggestion
    3. Algorithm outline (still no code)
    
    Args:
        problem_id: Problem ID
        problem_description: Problem description
        hint_level: Hint level (1-3)
        user_id: User ID
    
    Returns:
        Hint text (code-free)
    """
    
    # Build prompt for hint generation
    prompt = build_hint_prompt(problem_description, hint_level)
    
    # Check cache first
    cache_key = None
    cached_response = None
    
    if LLMCache:
        cache = LLMCache(os.environ['LLM_CACHE_TABLE'])
        cache_context = {
            'problem_id': problem_id,
            'hint_level': hint_level
        }
        cached_response = cache.get(
            query=f"hint_{problem_id}_level_{hint_level}",
            context=cache_context,
            model_id='claude-3-haiku'
        )
    
    if cached_response:
        # Use cached hint
        hint = cached_response['response']
        print(f"Cache hit for hint generation")
    else:
        # Invoke Bedrock (use Haiku for cost optimization)
        hint = invoke_bedrock_for_hint(prompt)
        
        # Validate hint is code-free
        if contains_code(hint):
            print("Warning: Generated hint contains code, regenerating...")
            # Regenerate with stricter prompt
            prompt = build_hint_prompt(problem_description, hint_level, strict=True)
            hint = invoke_bedrock_for_hint(prompt)
        
        # Store in cache
        if LLMCache and cache:
            cache.set(
                query=f"hint_{problem_id}_level_{hint_level}",
                response=hint,
                context=cache_context,
                model_id='claude-3-haiku'
            )
    
    return hint
def build_hint_prompt(
    problem_description: str,
    hint_level: int,
    strict: bool = False
) -> str:
    """
    Build prompt for hint generation
    
    Args:
        problem_description: Problem description
        hint_level: Hint level (1-3)
        strict: Use stricter code-free constraints
    
    Returns:
        Formatted prompt
    """
    
    # Base system prompt with code-free constraint
    system_prompt = """You are a programming mentor providing hints to help students solve problems.

CRITICAL RULES:
- DO NOT provide any code snippets or syntax
- DO NOT give explicit step-by-step solutions
- DO provide conceptual guidance and key insights
- DO suggest relevant data structures or algorithms
- DO ask guiding questions to help students think

Your goal is to guide students to discover the solution themselves."""
    
    if strict:
        system_prompt += "\n\nSTRICT MODE: Absolutely no code, pseudocode, or syntax of any kind."
    
    # Level-specific prompts
    level_prompts = {
        1: """Provide a Level 1 hint (high-level approach):
- What is the key insight or observation needed?
- What type of problem is this?
- What should the student think about first?

Keep it brief and conceptual.""",
        
        2: """Provide a Level 2 hint (data structure suggestion):
- What data structure would be most efficient?
- Why is this data structure appropriate?
- What operations will be needed?

Still no code - just concepts.""",
        
        3: """Provide a Level 3 hint (algorithm outline):
- What is the high-level algorithm approach?
- What are the main steps (conceptually)?
- What edge cases should be considered?

Describe the approach in plain English, no code."""
    }
    
    prompt = f"""{system_prompt}

Problem:
{problem_description}

{level_prompts[hint_level]}

Hint:"""
    
    return prompt
def invoke_bedrock_for_hint(prompt: str) -> str:
    """
    Invoke Bedrock for hint generation (using Haiku for cost optimization)
    
    Args:
        prompt: Formatted prompt
    
    Returns:
        Hint text
    """
    
    try:
        # Use Nova Lite for hint generation (cost-effective)
        request_body = {
            "messages": [
                {
                    "role": "user",
                    "content": [{"text": prompt}]
                }
            ],
            "inferenceConfig": {
                "max_new_tokens": 500,  # Hints should be concise
                "temperature": 0.7
            }
        }
        
        response = bedrock_client.invoke_model(
            modelId='apac.amazon.nova-lite-v1:0',
            body=json.dumps(request_body)
        )
        
        response_body = json.loads(response['body'].read())
        
        # Extract text from Nova response format
        output = response_body.get('output', {})
        message = output.get('message', {})
        content = message.get('content', [])
        
        if content and len(content) > 0:
            return content[0].get('text', '')
        
        raise Exception("Empty response from Bedrock")
    
    except Exception as e:
        print(f"Error invoking Bedrock for hint: {str(e)}")
        # Fallback to generic hint
        return "Think about what data structure would help you efficiently look up or store values."
def contains_code(text: str) -> bool:
    """
    Check if text contains code snippets
    
    Detects:
    - Code blocks (```)
    - Common programming syntax (=, ==, !=, {}, [], etc.)
    - Function calls with parentheses
    
    Args:
        text: Text to check
    
    Returns:
        True if code detected, False otherwise
    """
    
    # Check for code blocks
    if '```' in text:
        return True
    
    # Check for common code patterns
    code_patterns = [
        r'\bfor\s*\(',  # for loops
        r'\bwhile\s*\(',  # while loops
        r'\bif\s*\(',  # if statements
        r'\bdef\s+\w+\s*\(',  # Python functions
        r'\bfunction\s+\w+\s*\(',  # JavaScript functions
        r'\w+\s*=\s*\[',  # Array assignments
        r'\w+\s*=\s*\{',  # Object/dict assignments
        r'\w+\[.*\]\s*=',  # Array indexing
        r'\breturn\s+\w+',  # Return statements
    ]
    
    import re
    for pattern in code_patterns:
        if re.search(pattern, text):
            return True
    
    return False


def get_cors_headers() -> Dict[str, str]:
    """Return CORS headers for API responses"""
    return {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Request-ID',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
    }

"""
Integration test for chat mentor service
Tests the complete pipeline: intent → cache → RAG → Bedrock → response
"""

import pytest
from unittest.mock import Mock, patch, MagicMock
import json
import os
import sys
from datetime import datetime, timezone, timedelta

# Add genai directory to path for llm_cache import
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'genai'))

# Set environment variables
os.environ['CONVERSATION_HISTORY_TABLE'] = 'test-conversation-history-table'
os.environ['LLM_CACHE_TABLE'] = 'test-llm-cache-table'
os.environ['USERS_TABLE'] = 'test-users-table'
os.environ['AWS_DEFAULT_REGION'] = 'us-east-1'


@pytest.fixture
def mock_dynamodb():
    """Mock DynamoDB tables"""
    with patch('index.conversation_history_table') as mock_history, \
         patch('index.llm_cache_table') as mock_cache, \
         patch('index.users_table') as mock_users:
        yield {
            'history': mock_history,
            'cache': mock_cache,
            'users': mock_users
        }


@pytest.fixture
def mock_bedrock():
    """Mock Bedrock runtime client"""
    with patch('index.bedrock_runtime') as mock_bedrock:
        yield mock_bedrock


@pytest.fixture
def sample_user_context():
    """Sample user context with weak/strong topics"""
    return {
        'user_id': 'test-user-123',
        'leetcode_username': 'testuser',
        'leetcode_profile': {
            'username': 'testuser',
            'total_solved': 150,
            'topic_proficiency': {
                'arrays': {
                    'proficiency': 85.0,
                    'classification': 'strong',
                    'problems_solved': 25
                },
                'dynamic-programming': {
                    'proficiency': 35.0,
                    'classification': 'weak',
                    'problems_solved': 3
                },
                'graphs': {
                    'proficiency': 55.0,
                    'classification': 'moderate',
                    'problems_solved': 8
                }
            }
        }
    }


@pytest.fixture
def mock_bedrock_response():
    """Mock Bedrock API response"""
    return {
        'body': MagicMock(
            read=lambda: json.dumps({
                'content': [
                    {
                        'text': 'Great question! Dynamic programming is a technique where you break down complex problems into simpler subproblems. Let me guide you through the approach...'
                    }
                ]
            }).encode('utf-8')
        )
    }


def test_complete_chat_mentor_pipeline(mock_dynamodb, mock_bedrock, sample_user_context, mock_bedrock_response):
    """Test complete chat mentor pipeline: intent → cache → Bedrock → response"""
    # Import after mocking
    from index import handler
    
    # Mock user context
    mock_dynamodb['users'].get_item.return_value = {'Item': sample_user_context}
    
    # Mock cache miss (first request)
    mock_dynamodb['cache'].get_item.return_value = {}
    
    # Mock Bedrock response
    mock_bedrock.invoke_model.return_value = mock_bedrock_response
    
    # Create API Gateway event
    event = {
        'httpMethod': 'POST',
        'path': '/chat-mentor',
        'body': json.dumps({
            'user_id': 'test-user-123',
            'message': 'Can you explain dynamic programming?',
            'code': None,
            'problem_id': None
        })
    }
    
    # Call handler
    response = handler(event, None)
    
    # Verify response
    assert response['statusCode'] == 200
    body = json.loads(response['body'])
    
    # Verify response structure
    assert 'response' in body
    assert 'intent' in body
    assert 'cached' in body
    assert 'model_used' in body
    
    # Verify intent detection
    assert body['intent'] == 'CONCEPT_QUESTION'
    
    # Verify cache miss on first request
    assert body['cached'] == False
    
    # Verify model selection (Haiku for simple queries)
    assert body['model_used'] == 'haiku'
    
    # Verify response content
    assert 'Dynamic programming' in body['response'] or 'dynamic programming' in body['response']
    
    # Verify Bedrock was called
    mock_bedrock.invoke_model.assert_called_once()
    bedrock_call = mock_bedrock.invoke_model.call_args
    assert 'haiku' in bedrock_call[1]['modelId']
    
    # Verify conversation was stored
    mock_dynamodb['history'].put_item.assert_called_once()
    history_call = mock_dynamodb['history'].put_item.call_args
    stored_item = history_call[1]['Item']
    assert stored_item['user_id'] == 'test-user-123'
    assert stored_item['message'] == 'Can you explain dynamic programming?'
    assert stored_item['intent'] == 'CONCEPT_QUESTION'
    assert stored_item['cached'] == False


def test_cache_hit_reduces_latency(mock_dynamodb, mock_bedrock, sample_user_context):
    """Test that cache hit reduces latency to <50ms (no Bedrock call)"""
    from index import handler
    import time
    
    # Mock user context
    mock_dynamodb['users'].get_item.return_value = {'Item': sample_user_context}
    
    # Mock cache hit (second identical request) - need to mock the cache_bedrock_call function
    with patch('index.cache_bedrock_call') as mock_cache_call:
        # Configure mock to return cached response
        mock_cache_call.return_value = {
            'response': 'Cached response about dynamic programming',
            'cached': True,
            'cache_hit': True,
            'cached_at': datetime.now(timezone.utc).isoformat(),
            'access_count': 2
        }
        
        # Create API Gateway event
        event = {
            'httpMethod': 'POST',
            'path': '/chat-mentor',
            'body': json.dumps({
                'user_id': 'test-user-123',
                'message': 'Can you explain dynamic programming?'
            })
        }
        
        # Measure response time
        start_time = time.time()
        response = handler(event, None)
        elapsed_time = (time.time() - start_time) * 1000  # Convert to ms
        
        # Verify response
        assert response['statusCode'] == 200
        body = json.loads(response['body'])
        
        # Verify cache hit
        assert body['cached'] == True
        assert body['response'] == 'Cached response about dynamic programming'
        
        # Verify Bedrock was NOT called (cache hit)
        mock_bedrock.invoke_model.assert_not_called()
        
        # Verify latency is low (cache hit should be fast)
        # Note: In real scenario with actual DynamoDB, this would be <50ms
        # In unit test with mocks, it's much faster
        assert elapsed_time < 100  # Generous threshold for unit test
        
        # Verify cache_bedrock_call was called
        mock_cache_call.assert_called_once()


def test_code_debugging_intent_uses_sonnet(mock_dynamodb, mock_bedrock, sample_user_context, mock_bedrock_response):
    """Test that code debugging intent uses Claude Sonnet (more powerful model)"""
    from index import handler
    
    # Mock user context
    mock_dynamodb['users'].get_item.return_value = {'Item': sample_user_context}
    
    # Mock cache miss
    mock_dynamodb['cache'].get_item.return_value = {}
    
    # Mock Bedrock response
    mock_bedrock.invoke_model.return_value = mock_bedrock_response
    
    # Create event with code debugging request
    event = {
        'httpMethod': 'POST',
        'path': '/chat-mentor',
        'body': json.dumps({
            'user_id': 'test-user-123',
            'message': 'My code is giving wrong answer, can you help debug?',
            'code': 'def twoSum(nums, target):\n    for i in range(len(nums)):\n        for j in range(len(nums)):\n            if nums[i] + nums[j] == target:\n                return [i, j]'
        })
    }
    
    # Call handler
    response = handler(event, None)
    
    # Verify response
    assert response['statusCode'] == 200
    body = json.loads(response['body'])
    
    # Verify intent detection
    assert body['intent'] == 'CODE_DEBUGGING'
    
    # Verify Sonnet model was used (more powerful for code analysis)
    assert body['model_used'] == 'sonnet'
    
    # Verify Bedrock was called with Sonnet model
    mock_bedrock.invoke_model.assert_called_once()
    bedrock_call = mock_bedrock.invoke_model.call_args
    assert 'sonnet' in bedrock_call[1]['modelId']


def test_rag_context_injection(mock_dynamodb, mock_bedrock, sample_user_context, mock_bedrock_response):
    """Test that user context (weak/strong topics) is injected into prompt"""
    from index import handler
    
    # Mock user context with specific weak topics
    mock_dynamodb['users'].get_item.return_value = {'Item': sample_user_context}
    
    # Mock cache miss
    mock_dynamodb['cache'].get_item.return_value = {}
    
    # Mock Bedrock response
    mock_bedrock.invoke_model.return_value = mock_bedrock_response
    
    # Create event
    event = {
        'httpMethod': 'POST',
        'path': '/chat-mentor',
        'body': json.dumps({
            'user_id': 'test-user-123',
            'message': 'What should I practice next?'
        })
    }
    
    # Call handler
    response = handler(event, None)
    
    # Verify response
    assert response['statusCode'] == 200
    
    # Verify Bedrock was called
    mock_bedrock.invoke_model.assert_called_once()
    bedrock_call = mock_bedrock.invoke_model.call_args
    
    # Extract prompt from Bedrock call
    request_body = json.loads(bedrock_call[1]['body'])
    prompt = request_body['messages'][0]['content']
    
    # Verify user context is injected into prompt
    assert 'dynamic-programming' in prompt  # Weak topic should be mentioned
    assert 'weak' in prompt.lower() or 'areas' in prompt.lower()


def test_conversation_history_persistence(mock_dynamodb, mock_bedrock, sample_user_context, mock_bedrock_response):
    """Test that conversation history is stored in DynamoDB"""
    from index import handler
    
    # Mock user context
    mock_dynamodb['users'].get_item.return_value = {'Item': sample_user_context}
    
    # Mock cache miss
    mock_dynamodb['cache'].get_item.return_value = {}
    
    # Mock Bedrock response
    mock_bedrock.invoke_model.return_value = mock_bedrock_response
    
    # Create event
    event = {
        'httpMethod': 'POST',
        'path': '/chat-mentor',
        'body': json.dumps({
            'user_id': 'test-user-123',
            'message': 'Explain binary search'
        })
    }
    
    # Call handler
    response = handler(event, None)
    
    # Verify response
    assert response['statusCode'] == 200
    
    # Verify conversation was stored
    mock_dynamodb['history'].put_item.assert_called_once()
    history_call = mock_dynamodb['history'].put_item.call_args
    stored_item = history_call[1]['Item']
    
    # Verify stored conversation structure
    assert 'conversation_id' in stored_item
    assert stored_item['user_id'] == 'test-user-123'
    assert stored_item['message'] == 'Explain binary search'
    assert 'response' in stored_item
    assert 'intent' in stored_item
    assert 'cached' in stored_item
    assert 'timestamp' in stored_item
    assert 'ttl' in stored_item
    
    # Verify TTL is set (30 days)
    now = datetime.now(timezone.utc)
    expected_ttl = int((now + timedelta(days=30)).timestamp())
    # Allow 60 second tolerance for test execution time
    assert abs(stored_item['ttl'] - expected_ttl) < 60


def test_get_conversation_history(mock_dynamodb, mock_bedrock, sample_user_context):
    """Test GET /chat-mentor/{user_id}/history endpoint"""
    from index import handler
    
    # Mock conversation history data
    conversations = [
        {
            'conversation_id': 'test-user-123#2024-01-15T10:00:00+00:00',
            'user_id': 'test-user-123',
            'message': 'Explain dynamic programming',
            'response': 'Dynamic programming is...',
            'intent': 'CONCEPT_QUESTION',
            'cached': False,
            'timestamp': '2024-01-15T10:00:00+00:00'
        },
        {
            'conversation_id': 'test-user-123#2024-01-15T11:00:00+00:00',
            'user_id': 'test-user-123',
            'message': 'Give me a hint for two sum',
            'response': 'Think about using a hash map...',
            'intent': 'HINT_REQUEST',
            'cached': False,
            'timestamp': '2024-01-15T11:00:00+00:00'
        }
    ]
    
    # Mock DynamoDB query
    mock_dynamodb['history'].query.return_value = {'Items': conversations}
    
    # Create GET request event
    event = {
        'httpMethod': 'GET',
        'path': '/chat-mentor/test-user-123/history',
        'pathParameters': {'user_id': 'test-user-123'}
    }
    
    # Call handler
    response = handler(event, None)
    
    # Verify response
    assert response['statusCode'] == 200
    body = json.loads(response['body'])
    
    # Verify response structure
    assert body['user_id'] == 'test-user-123'
    assert 'conversations' in body
    assert 'count' in body
    assert body['count'] == 2
    
    # Verify conversations
    assert len(body['conversations']) == 2
    assert body['conversations'][0]['message'] == 'Explain dynamic programming'
    assert body['conversations'][0]['intent'] == 'CONCEPT_QUESTION'
    assert body['conversations'][1]['message'] == 'Give me a hint for two sum'
    assert body['conversations'][1]['intent'] == 'HINT_REQUEST'
    
    # Verify query was called with correct parameters
    mock_dynamodb['history'].query.assert_called_once()
    query_call = mock_dynamodb['history'].query.call_args
    assert query_call[1]['IndexName'] == 'user_id-index'
    assert query_call[1]['Limit'] == 50
    assert query_call[1]['ScanIndexForward'] == False  # Most recent first


def test_intent_detection_patterns(mock_dynamodb, mock_bedrock, sample_user_context):
    """Test various intent detection patterns"""
    from index import detect_intent
    
    # Test CODE_DEBUGGING intent
    assert detect_intent('My code has an error') == 'CODE_DEBUGGING'
    assert detect_intent('This is giving wrong answer') == 'CODE_DEBUGGING'
    assert detect_intent('Help me debug this') == 'CODE_DEBUGGING'
    assert detect_intent('My solution fails on test case 5') == 'CODE_DEBUGGING'
    
    # Test HINT_REQUEST intent
    assert detect_intent('Can you give me a hint?') == 'HINT_REQUEST'
    assert detect_intent('I am stuck on this problem') == 'HINT_REQUEST'
    assert detect_intent('Help me start this problem') == 'HINT_REQUEST'
    assert detect_intent('Give me a clue') == 'HINT_REQUEST'
    
    # Test CONCEPT_QUESTION intent
    assert detect_intent('What is dynamic programming?') == 'CONCEPT_QUESTION'
    assert detect_intent('Explain binary search') == 'CONCEPT_QUESTION'
    assert detect_intent('How does DFS work?') == 'CONCEPT_QUESTION'
    assert detect_intent('Why use a hash map?') == 'CONCEPT_QUESTION'
    assert detect_intent('What is the difference between BFS and DFS?') == 'CONCEPT_QUESTION'
    
    # Test GENERAL intent (fallback)
    assert detect_intent('Hello') == 'GENERAL'
    assert detect_intent('Thanks for your help') == 'GENERAL'


def test_error_handling_missing_fields(mock_dynamodb, mock_bedrock):
    """Test error handling when required fields are missing"""
    from index import handler
    
    # Test missing user_id
    event = {
        'httpMethod': 'POST',
        'path': '/chat-mentor',
        'body': json.dumps({
            'message': 'Explain DP'
        })
    }
    
    response = handler(event, None)
    assert response['statusCode'] == 400
    body = json.loads(response['body'])
    assert 'error' in body
    
    # Test missing message
    event = {
        'httpMethod': 'POST',
        'path': '/chat-mentor',
        'body': json.dumps({
            'user_id': 'test-user-123'
        })
    }
    
    response = handler(event, None)
    assert response['statusCode'] == 400
    body = json.loads(response['body'])
    assert 'error' in body


def test_error_handling_bedrock_failure(mock_dynamodb, mock_bedrock, sample_user_context):
    """Test error handling when Bedrock API fails"""
    from index import handler
    
    # Mock user context
    mock_dynamodb['users'].get_item.return_value = {'Item': sample_user_context}
    
    # Mock cache miss
    mock_dynamodb['cache'].get_item.return_value = {}
    
    # Mock Bedrock failure
    mock_bedrock.invoke_model.side_effect = Exception('Bedrock API error')
    
    # Create event
    event = {
        'httpMethod': 'POST',
        'path': '/chat-mentor',
        'body': json.dumps({
            'user_id': 'test-user-123',
            'message': 'Explain DP'
        })
    }
    
    # Call handler
    response = handler(event, None)
    
    # Verify error response
    assert response['statusCode'] == 500
    body = json.loads(response['body'])
    assert 'error' in body


if __name__ == '__main__':
    pytest.main([__file__, '-v'])

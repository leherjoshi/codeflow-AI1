"""
Property-based tests for LLM Cache hit/miss behavior
"""

import pytest
import hashlib
import json
import os
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, Optional
from hypothesis import given, strategies as st, settings, assume
from unittest.mock import Mock, patch, MagicMock

# Set AWS region before importing llm_cache to avoid boto3 errors
os.environ['AWS_DEFAULT_REGION'] = 'us-east-1'

# Mock boto3 before importing llm_cache
with patch('boto3.resource'), patch('boto3.client'):
    from llm_cache import LLMCache


# ============================================================================
# Test Fixtures and Helpers
# ============================================================================

@pytest.fixture
def mock_dynamodb_table():
    """Mock DynamoDB table for testing"""
    table = Mock()
    table.get_item = Mock()
    table.put_item = Mock()
    table.update_item = Mock()
    table.scan = Mock()
    table.delete_item = Mock()
    return table


@pytest.fixture
def mock_cloudwatch():
    """Mock CloudWatch client for testing"""
    client = Mock()
    client.put_metric_data = Mock()
    return client


@pytest.fixture
def llm_cache(mock_dynamodb_table, mock_cloudwatch):
    """Create LLMCache instance with mocked dependencies"""
    with patch('llm_cache.dynamodb') as mock_dynamodb, \
         patch('llm_cache.boto3.client', return_value=mock_cloudwatch):
        mock_dynamodb.Table.return_value = mock_dynamodb_table
        cache = LLMCache(table_name='test-cache-table', ttl_days=7)
        cache.table = mock_dynamodb_table
        cache.cloudwatch = mock_cloudwatch
        return cache


# ============================================================================
# Hypothesis Strategies
# ============================================================================

# Strategy for generating valid queries
queries_strategy = st.text(
    alphabet=st.characters(whitelist_categories=('L', 'N', 'P', 'Z')),
    min_size=5,
    max_size=200
)

# Strategy for generating context dictionaries
context_strategy = st.one_of(
    st.none(),
    st.fixed_dictionaries({
        'user_id': st.text(min_size=1, max_size=50),
        'topic': st.sampled_from(['algorithms', 'data-structures', 'dynamic-programming', 'graphs']),
        'proficiency': st.sampled_from(['beginner', 'intermediate', 'advanced'])
    })
)

# Strategy for generating model IDs
model_id_strategy = st.sampled_from([
    'claude-3-sonnet',
    'claude-3-opus',
    'claude-3-haiku'
])

# Strategy for generating responses
response_strategy = st.text(min_size=10, max_size=1000)


# ============================================================================
# Unit Tests
# ============================================================================

def test_generate_cache_key_deterministic(llm_cache):
    """Test that cache key generation is deterministic"""
    query = "What is dynamic programming?"
    context = {'user_id': 'user123', 'topic': 'algorithms'}
    model_id = 'claude-3-sonnet'
    
    key1 = llm_cache.generate_cache_key(query, context, model_id)
    key2 = llm_cache.generate_cache_key(query, context, model_id)
    
    assert key1 == key2, "Cache key should be deterministic for identical inputs"


def test_generate_cache_key_different_queries(llm_cache):
    """Test that different queries produce different cache keys"""
    query1 = "What is dynamic programming?"
    query2 = "What is greedy algorithm?"
    context = {'user_id': 'user123'}
    
    key1 = llm_cache.generate_cache_key(query1, context)
    key2 = llm_cache.generate_cache_key(query2, context)
    
    assert key1 != key2, "Different queries should produce different cache keys"


def test_cache_hit_returns_cached_response(llm_cache, mock_dynamodb_table):
    """Test that cache hit returns the cached response"""
    query = "What is dynamic programming?"
    response_text = "Dynamic programming is a method for solving complex problems..."
    
    # Setup mock to return cached item
    now = datetime.now(timezone.utc)
    ttl = int((now + timedelta(days=7)).timestamp())
    
    mock_dynamodb_table.get_item.return_value = {
        'Item': {
            'query_hash': 'test_hash',
            'response': response_text,
            'model_id': 'claude-3-sonnet',
            'cached_at': now.isoformat(),
            'ttl': ttl,
            'access_count': 0
        }
    }
    
    # Get from cache
    result = llm_cache.get(query)
    
    assert result is not None
    assert result['response'] == response_text
    assert result['model_id'] == 'claude-3-sonnet'


def test_cache_miss_returns_none(llm_cache, mock_dynamodb_table):
    """Test that cache miss returns None"""
    query = "What is dynamic programming?"
    
    # Setup mock to return no item
    mock_dynamodb_table.get_item.return_value = {}
    
    # Get from cache
    result = llm_cache.get(query)
    
    assert result is None


def test_cache_expired_returns_none(llm_cache, mock_dynamodb_table):
    """Test that expired cache entry returns None"""
    query = "What is dynamic programming?"
    
    # Setup mock to return expired item
    now = datetime.now(timezone.utc)
    expired_ttl = int((now - timedelta(days=1)).timestamp())
    
    mock_dynamodb_table.get_item.return_value = {
        'Item': {
            'query_hash': 'test_hash',
            'response': 'Some response',
            'model_id': 'claude-3-sonnet',
            'cached_at': (now - timedelta(days=8)).isoformat(),
            'ttl': expired_ttl,
            'access_count': 0
        }
    }
    
    # Get from cache
    result = llm_cache.get(query)
    
    assert result is None


def test_cache_set_stores_response(llm_cache, mock_dynamodb_table):
    """Test that cache set stores the response"""
    query = "What is dynamic programming?"
    response = "Dynamic programming is a method..."
    context = {'user_id': 'user123'}
    
    # Set cache
    result = llm_cache.set(query, response, context)
    
    assert result is True
    mock_dynamodb_table.put_item.assert_called_once()


def test_cache_set_includes_ttl(llm_cache, mock_dynamodb_table):
    """Test that cache set includes TTL"""
    query = "What is dynamic programming?"
    response = "Dynamic programming is a method..."
    
    # Set cache
    llm_cache.set(query, response)
    
    # Verify put_item was called with TTL
    call_args = mock_dynamodb_table.put_item.call_args
    item = call_args[1]['Item']
    
    assert 'ttl' in item
    assert item['ttl'] > int(datetime.now(timezone.utc).timestamp())


# ============================================================================
# Property-Based Tests
# ============================================================================

# **Validates: LLM Cache correctness**
# Property: Cache returns same response for identical query hash


@given(
    query=queries_strategy,
    context=context_strategy,
    model_id=model_id_strategy,
    response=response_strategy
)
@settings(max_examples=100)
def test_property_cache_hit_returns_same_response(
    query,
    context,
    model_id,
    response
):
    """
    Property: Cache returns same response for identical query hash
    **Validates: LLM Cache correctness**
    
    For any query, context, and model_id combination, if a response is cached,
    subsequent requests with the same inputs should return the exact same response.
    
    This test verifies:
    1. Cache key generation is deterministic
    2. Cache hit returns the exact cached response
    3. Response content is preserved without modification
    """
    # Create mocks inside the test
    mock_dynamodb_table = Mock()
    mock_cloudwatch = Mock()
    
    with patch('llm_cache.dynamodb') as mock_dynamodb, \
         patch('llm_cache.boto3.client', return_value=mock_cloudwatch):
        mock_dynamodb.Table.return_value = mock_dynamodb_table
        cache = LLMCache(table_name='test-cache-table', ttl_days=7)
        cache.table = mock_dynamodb_table
        cache.cloudwatch = mock_cloudwatch
        
        # Generate cache key
        cache_key = cache.generate_cache_key(query, context, model_id)
        
        # Setup mock to return cached item
        now = datetime.now(timezone.utc)
        ttl = int((now + timedelta(days=7)).timestamp())
        
        mock_dynamodb_table.get_item.return_value = {
            'Item': {
                'query_hash': cache_key,
                'response': response,
                'model_id': model_id,
                'cached_at': now.isoformat(),
                'ttl': ttl,
                'access_count': 0
            }
        }
        
        # Get from cache twice
        result1 = cache.get(query, context, model_id)
        result2 = cache.get(query, context, model_id)
        
        # Property: Both results should be identical
        assert result1 is not None, "First cache hit should return response"
        assert result2 is not None, "Second cache hit should return response"
        assert result1['response'] == response, "First result should match cached response"
        assert result2['response'] == response, "Second result should match cached response"
        assert result1['response'] == result2['response'], \
            "Multiple cache hits should return identical responses"


@given(
    query=queries_strategy,
    context=context_strategy,
    model_id=model_id_strategy
)
@settings(max_examples=100)
def test_property_cache_key_deterministic(query, context, model_id):
    """
    Property: Cache key generation is deterministic
    **Validates: LLM Cache correctness**
    
    For any query, context, and model_id combination, generating the cache key
    multiple times should always produce the same result.
    
    This test verifies:
    1. Cache key generation is consistent
    2. No randomness in key generation
    3. Same inputs always produce same key
    """
    with patch('llm_cache.dynamodb'), patch('llm_cache.boto3.client'):
        cache = LLMCache(table_name='test-cache-table', ttl_days=7)
        
        # Generate cache key multiple times
        key1 = cache.generate_cache_key(query, context, model_id)
        key2 = cache.generate_cache_key(query, context, model_id)
        key3 = cache.generate_cache_key(query, context, model_id)
        
        # Property: All keys should be identical
        assert key1 == key2 == key3, \
            f"Cache key generation should be deterministic. " \
            f"Got different keys: {key1}, {key2}, {key3}"
        
        # Property: Key should be a valid hex string
        assert isinstance(key1, str), "Cache key should be a string"
        assert len(key1) > 0, "Cache key should not be empty"


@given(
    query1=queries_strategy,
    query2=queries_strategy,
    context=context_strategy,
    model_id=model_id_strategy
)
@settings(max_examples=100)
def test_property_different_queries_different_keys(query1, query2, context, model_id):
    """
    Property: Different queries produce different cache keys
    **Validates: LLM Cache correctness**
    
    For any two different queries (with same context and model), the cache keys
    should be different to prevent incorrect cache hits.
    
    This test verifies:
    1. Query content affects cache key
    2. Different queries don't collide
    3. Cache isolation between queries
    """
    # Assume queries are different
    assume(query1 != query2)
    
    with patch('llm_cache.dynamodb'), patch('llm_cache.boto3.client'):
        cache = LLMCache(table_name='test-cache-table', ttl_days=7)
        
        # Generate cache keys
        key1 = cache.generate_cache_key(query1, context, model_id)
        key2 = cache.generate_cache_key(query2, context, model_id)
        
        # Property: Different queries should produce different keys
        assert key1 != key2, \
            f"Different queries should produce different cache keys. " \
            f"Query1: '{query1[:50]}...', Query2: '{query2[:50]}...', " \
            f"Key1: {key1}, Key2: {key2}"


@given(
    query=queries_strategy,
    response=response_strategy,
    context=context_strategy,
    model_id=model_id_strategy,
    ttl_days=st.integers(min_value=1, max_value=30)
)
@settings(max_examples=100)
def test_property_cache_miss_before_set(
    query,
    response,
    context,
    model_id,
    ttl_days
):
    """
    Property: Cache miss occurs before setting cache
    **Validates: LLM Cache correctness**
    
    For any query that has not been cached yet, a cache lookup should return None
    (cache miss), indicating that a Bedrock call is needed.
    
    This test verifies:
    1. Cache miss returns None for uncached queries
    2. Cache doesn't return false positives
    3. Proper cache miss detection
    """
    # Create mocks inside the test
    mock_dynamodb_table = Mock()
    mock_cloudwatch = Mock()
    
    with patch('llm_cache.dynamodb') as mock_dynamodb, \
         patch('llm_cache.boto3.client', return_value=mock_cloudwatch):
        mock_dynamodb.Table.return_value = mock_dynamodb_table
        cache = LLMCache(table_name='test-cache-table', ttl_days=ttl_days)
        cache.table = mock_dynamodb_table
        cache.cloudwatch = mock_cloudwatch
        
        # Setup mock to return no item (cache miss)
        mock_dynamodb_table.get_item.return_value = {}
        
        # Get from cache (should be miss)
        result = cache.get(query, context, model_id)
        
        # Property: Cache miss should return None
        assert result is None, \
            f"Cache miss should return None for uncached query. Got: {result}"


@given(
    query=queries_strategy,
    response=response_strategy,
    context=context_strategy,
    model_id=model_id_strategy,
    hours_until_expiry=st.floats(min_value=-48.0, max_value=0.0)
)
@settings(max_examples=100)
def test_property_expired_cache_returns_none(
    query,
    response,
    context,
    model_id,
    hours_until_expiry
):
    """
    Property: Expired cache entries return None (cache miss)
    **Validates: LLM Cache correctness**
    
    For any cached response with an expired TTL, a cache lookup should return None,
    forcing a fresh Bedrock call.
    
    This test verifies:
    1. TTL expiration is properly checked
    2. Expired entries are treated as cache misses
    3. No stale data is returned
    """
    # Create mocks inside the test
    mock_dynamodb_table = Mock()
    mock_cloudwatch = Mock()
    
    with patch('llm_cache.dynamodb') as mock_dynamodb, \
         patch('llm_cache.boto3.client', return_value=mock_cloudwatch):
        mock_dynamodb.Table.return_value = mock_dynamodb_table
        cache = LLMCache(table_name='test-cache-table', ttl_days=7)
        cache.table = mock_dynamodb_table
        cache.cloudwatch = mock_cloudwatch
        
        # Generate cache key
        cache_key = cache.generate_cache_key(query, context, model_id)
        
        # Setup mock to return expired item
        now = datetime.now(timezone.utc)
        expired_ttl = int((now + timedelta(hours=hours_until_expiry)).timestamp())
        
        mock_dynamodb_table.get_item.return_value = {
            'Item': {
                'query_hash': cache_key,
                'response': response,
                'model_id': model_id,
                'cached_at': (now + timedelta(hours=hours_until_expiry - 24)).isoformat(),
                'ttl': expired_ttl,
                'access_count': 0
            }
        }
        
        # Get from cache
        result = cache.get(query, context, model_id)
        
        # Property: Expired cache should return None
        assert result is None, \
            f"Expired cache entry should return None. " \
            f"TTL: {expired_ttl}, Now: {int(now.timestamp())}, " \
            f"Hours until expiry: {hours_until_expiry}"


@given(
    query=queries_strategy,
    response=response_strategy,
    context=context_strategy,
    model_id=model_id_strategy
)
@settings(max_examples=100)
def test_property_cache_set_then_get_returns_response(
    query,
    response,
    context,
    model_id
):
    """
    Property: Setting cache then getting returns the same response
    **Validates: LLM Cache correctness**
    
    For any query and response, after setting the cache, a subsequent get
    should return the exact same response (simulating cache hit after Bedrock call).
    
    This test verifies:
    1. Cache set operation stores data correctly
    2. Cache get retrieves the stored data
    3. Round-trip consistency (set → get)
    """
    # Create mocks inside the test
    mock_dynamodb_table = Mock()
    mock_cloudwatch = Mock()
    
    with patch('llm_cache.dynamodb') as mock_dynamodb, \
         patch('llm_cache.boto3.client', return_value=mock_cloudwatch):
        mock_dynamodb.Table.return_value = mock_dynamodb_table
        cache = LLMCache(table_name='test-cache-table', ttl_days=7)
        cache.table = mock_dynamodb_table
        cache.cloudwatch = mock_cloudwatch
        
        # Set cache
        set_result = cache.set(query, response, context, model_id)
        assert set_result is True, "Cache set should succeed"
        
        # Verify put_item was called
        assert mock_dynamodb_table.put_item.called, "put_item should be called"
        
        # Get the item that was stored
        call_args = mock_dynamodb_table.put_item.call_args
        stored_item = call_args[1]['Item']
        
        # Setup mock to return the stored item
        mock_dynamodb_table.get_item.return_value = {'Item': stored_item}
        
        # Get from cache
        get_result = cache.get(query, context, model_id)
        
        # Property: Get should return the same response that was set
        assert get_result is not None, "Cache get should return a result"
        assert get_result['response'] == response, \
            f"Cache get should return the same response that was set. " \
            f"Expected: '{response[:50]}...', Got: '{get_result['response'][:50]}...'"


@given(
    query=queries_strategy,
    context1=context_strategy,
    context2=context_strategy,
    model_id=model_id_strategy
)
@settings(max_examples=100)
def test_property_different_contexts_different_keys(
    query,
    context1,
    context2,
    model_id
):
    """
    Property: Different contexts produce different cache keys
    **Validates: LLM Cache correctness**
    
    For the same query but different contexts (e.g., different user proficiency),
    the cache keys should be different to ensure personalized responses.
    
    This test verifies:
    1. Context affects cache key generation
    2. Personalized caching works correctly
    3. No cache collision between different contexts
    """
    # Assume contexts are different
    assume(context1 != context2)
    
    with patch('llm_cache.dynamodb'), patch('llm_cache.boto3.client'):
        cache = LLMCache(table_name='test-cache-table', ttl_days=7)
        
        # Generate cache keys
        key1 = cache.generate_cache_key(query, context1, model_id)
        key2 = cache.generate_cache_key(query, context2, model_id)
        
        # Property: Different contexts should produce different keys
        assert key1 != key2, \
            f"Different contexts should produce different cache keys. " \
            f"Context1: {context1}, Context2: {context2}, " \
            f"Key1: {key1}, Key2: {key2}"


@given(
    query=queries_strategy,
    response=response_strategy,
    context=context_strategy,
    access_count=st.integers(min_value=0, max_value=100)
)
@settings(max_examples=100)
def test_property_cache_hit_increments_access_count(
    query,
    response,
    context,
    access_count
):
    """
    Property: Cache hit increments access count
    **Validates: LLM Cache correctness**
    
    For any cache hit, the access count should be incremented to track
    cache effectiveness and popular queries.
    
    This test verifies:
    1. Access count is tracked on cache hits
    2. Update operation is called
    3. Metrics are properly maintained
    """
    # Create mocks inside the test
    mock_dynamodb_table = Mock()
    mock_cloudwatch = Mock()
    
    with patch('llm_cache.dynamodb') as mock_dynamodb, \
         patch('llm_cache.boto3.client', return_value=mock_cloudwatch):
        mock_dynamodb.Table.return_value = mock_dynamodb_table
        cache = LLMCache(table_name='test-cache-table', ttl_days=7)
        cache.table = mock_dynamodb_table
        cache.cloudwatch = mock_cloudwatch
        
        # Generate cache key
        cache_key = cache.generate_cache_key(query, context)
        
        # Setup mock to return cached item
        now = datetime.now(timezone.utc)
        ttl = int((now + timedelta(days=7)).timestamp())
        
        mock_dynamodb_table.get_item.return_value = {
            'Item': {
                'query_hash': cache_key,
                'response': response,
                'model_id': 'claude-3-sonnet',
                'cached_at': now.isoformat(),
                'ttl': ttl,
                'access_count': access_count
            }
        }
        
        # Get from cache (cache hit)
        result = cache.get(query, context)
        
        # Property: Access count should be incremented
        assert result is not None, "Cache hit should return result"
        assert mock_dynamodb_table.update_item.called, \
            "update_item should be called to increment access count"
        
        # Verify update_item was called with correct parameters
        call_args = mock_dynamodb_table.update_item.call_args
        assert 'Key' in call_args[1], "update_item should include Key"
        assert 'UpdateExpression' in call_args[1], "update_item should include UpdateExpression"


if __name__ == '__main__':
    pytest.main([__file__, '-v'])

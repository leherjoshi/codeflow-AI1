"""
Cache manager for AI Interview Simulator

Integrates with existing LLM cache for cost optimization
"""

import os
import hashlib
import json
from typing import Dict, Any, Optional
import boto3

# Import existing LLM cache (reuse from genai module)
import sys
sys.path.append('/opt/python')  # Lambda layer path
sys.path.append('../genai')  # Local development path

try:
    from llm_cache import LLMCache
except ImportError:
    # Fallback if import fails
    print("Warning: Could not import LLMCache, using stub implementation")
    class LLMCache:
        def __init__(self, table_name, ttl_days=7):
            self.table_name = table_name
        def get(self, query, context=None, model_id="claude-3-sonnet"):
            return None
        def put(self, query, response, context=None, model_id="claude-3-sonnet"):
            pass

# Environment variables
LLM_CACHE_TABLE = os.environ.get('LLM_CACHE_TABLE', 'codeflow-llm-cache-dev')
CACHE_TTL_DAYS = 7

# Initialize cache
cache = LLMCache(table_name=LLM_CACHE_TABLE, ttl_days=CACHE_TTL_DAYS)

# CloudWatch client for metrics
cloudwatch = boto3.client('cloudwatch')
def generate_cache_key(code: str, problem_id: str) -> str:
    """
    Generate cache key for code evaluation
    
    Normalizes code to improve cache hit rate:
    - Remove comments
    - Normalize whitespace
    - Convert to lowercase
    
    Args:
        code: Code solution
        problem_id: Problem identifier
        
    Returns:
        SHA-256 hash of normalized code + problem_id
    """
    normalized_code = normalize_code(code)
    cache_input = f"{normalized_code}|{problem_id}"
    return hashlib.sha256(cache_input.encode('utf-8')).hexdigest()
def normalize_code(code: str) -> str:
    """
    Normalize code for caching
    
    Removes comments, normalizes whitespace, converts to lowercase
    
    Args:
        code: Raw code string
        
    Returns:
        Normalized code string
    """
    lines = []
    for line in code.split('\n'):
        # Remove Python comments
        if '#' in line:
            line = line[:line.index('#')]
        # Remove inline comments for other languages
        if '//' in line:
            line = line[:line.index('//')]
        # Strip whitespace and convert to lowercase
        line = line.strip().lower()
        if line:
            lines.append(line)
    
    # Join with single space
    return ' '.join(lines)
def check_cache(
    operation: str,
    query: str,
    context: Optional[Dict[str, Any]] = None
) -> Optional[Dict[str, Any]]:
    """
    Check cache for a previous response
    
    Args:
        operation: Operation type (evaluation, behavioral, feedback)
        query: Query text (code, response, session summary)
        context: Additional context (problem_id, session_id, etc.)
        
    Returns:
        Cached response or None if cache miss
    """
    try:
        # Add operation to context
        cache_context = context or {}
        cache_context['operation'] = operation
        
        # Check cache using existing LLM cache
        cached_response = cache.get(
            query=query,
            context=cache_context,
            model_id="claude-3-sonnet"
        )
        
        if cached_response:
            # Log cache hit
            emit_cache_metric('hit', operation)
            print(f"Cache HIT for {operation}")
            return cached_response.get('response')
        else:
            # Log cache miss
            emit_cache_metric('miss', operation)
            print(f"Cache MISS for {operation}")
            return None
            
    except Exception as e:
        print(f"Error checking cache: {str(e)}")
        emit_cache_metric('error', operation)
        return None
def store_in_cache(
    operation: str,
    query: str,
    response: Dict[str, Any],
    context: Optional[Dict[str, Any]] = None
) -> None:
    """
    Store response in cache
    
    Args:
        operation: Operation type (evaluation, behavioral, feedback)
        query: Query text
        response: Response to cache
        context: Additional context
    """
    try:
        # Add operation to context
        cache_context = context or {}
        cache_context['operation'] = operation
        
        # Store in cache using existing LLM cache
        cache.put(
            query=query,
            response=response,
            context=cache_context,
            model_id="claude-3-sonnet"
        )
        
        print(f"Stored in cache for {operation}")
        
    except Exception as e:
        print(f"Error storing in cache: {str(e)}")
def emit_cache_metric(result: str, operation: str) -> None:
    """
    Emit cache hit/miss metrics to CloudWatch
    
    Args:
        result: 'hit', 'miss', or 'error'
        operation: Operation type
    """
    try:
        cloudwatch.put_metric_data(
            Namespace='CodeFlow/InterviewSimulator',
            MetricData=[
                {
                    'MetricName': 'CacheResult',
                    'Value': 1,
                    'Unit': 'Count',
                    'Dimensions': [
                        {'Name': 'Result', 'Value': result},
                        {'Name': 'Operation', 'Value': operation}
                    ]
                }
            ]
        )
    except Exception as e:
        print(f"Error emitting cache metric: {str(e)}")


# Convenience functions for specific operations

def check_evaluation_cache(code: str, problem_id: str) -> Optional[Dict[str, Any]]:
    """Check cache for code evaluation"""
    normalized_code = normalize_code(code)
    return check_cache(
        operation='evaluation',
        query=normalized_code,
        context={'problem_id': problem_id}
    )


def store_evaluation_cache(code: str, problem_id: str, evaluation: Dict[str, Any]) -> None:
    """Store code evaluation in cache"""
    normalized_code = normalize_code(code)
    store_in_cache(
        operation='evaluation',
        query=normalized_code,
        response=evaluation,
        context={'problem_id': problem_id}
    )


def check_behavioral_cache(question: str, response: str) -> Optional[Dict[str, Any]]:
    """Check cache for behavioral assessment"""
    query = f"{question}|{response}"
    return check_cache(
        operation='behavioral',
        query=query
    )


def store_behavioral_cache(question: str, response: str, assessment: Dict[str, Any]) -> None:
    """Store behavioral assessment in cache"""
    query = f"{question}|{response}"
    store_in_cache(
        operation='behavioral',
        query=query,
        response=assessment
    )


def check_feedback_cache(session_summary: str) -> Optional[Dict[str, Any]]:
    """Check cache for feedback report"""
    return check_cache(
        operation='feedback',
        query=session_summary
    )


def store_feedback_cache(session_summary: str, feedback: Dict[str, Any]) -> None:
    """Store feedback report in cache"""
    store_in_cache(
        operation='feedback',
        query=session_summary,
        response=feedback
    )

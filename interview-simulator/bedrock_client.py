"""
Bedrock client wrapper for AI Interview Simulator

Handles Bedrock API calls with retry logic and call limiting
"""

import os
import json
import time
import random
from typing import Dict, Any, List, Optional
import boto3
from botocore.exceptions import ClientError

# Environment variables
BEDROCK_MODEL_ID = os.environ.get('BEDROCK_MODEL_ID', 'apac.amazon.nova-lite-v1:0')
BEDROCK_REGION = os.environ.get('AWS_REGION', 'us-east-1')
MAX_BEDROCK_CALLS_PER_SESSION = 10

# Initialize Bedrock client
bedrock_runtime = boto3.client('bedrock-runtime', region_name=BEDROCK_REGION)


class BedrockCallLimiter:
    """Tracks and enforces Bedrock call limits per session"""
    
    def __init__(self, max_calls: int = MAX_BEDROCK_CALLS_PER_SESSION):
        self.max_calls = max_calls
    
    def check_limit(self, current_count: int) -> None:
        """
        Check if call limit has been reached
        
        Args:
            current_count: Current number of calls made
            
        Raises:
            Exception: If limit exceeded
        """
        if current_count >= self.max_calls:
            raise Exception(
                f"Bedrock call limit exceeded. Maximum {self.max_calls} calls per session."
            )
    
    def get_remaining_calls(self, current_count: int) -> int:
        """Get number of remaining calls"""
        return max(0, self.max_calls - current_count)
def invoke_bedrock(
    prompt: str,
    conversation_history: Optional[List[Dict[str, str]]] = None,
    temperature: float = 0.7,
    max_tokens: int = 2000,
    system_prompt: Optional[str] = None
) -> str:
    """
    Invoke Bedrock Claude 3 Sonnet with retry logic
    
    Args:
        prompt: User prompt
        conversation_history: Previous conversation messages
        temperature: Model temperature (0-1)
        max_tokens: Maximum tokens to generate
        system_prompt: System prompt for model behavior
        
    Returns:
        Model response text
        
    Raises:
        Exception: If all retry attempts fail
    """
    # Build messages array for Nova format
    messages = []
    
    # Add conversation history
    if conversation_history:
        messages.extend(conversation_history)
    
    # Add current prompt
    messages.append({
        "role": "user",
        "content": prompt
    })
    
    # Convert messages to Nova format (content must be array of objects)
    nova_messages = []
    for msg in messages:
        content = msg.get("content", "")
        # Handle both string and array content formats
        if isinstance(content, str):
            nova_messages.append({
                "role": msg["role"],
                "content": [{"text": content}]
            })
        else:
            nova_messages.append(msg)
    
    # Build request body for Nova
    request_body = {
        "messages": nova_messages,
        "inferenceConfig": {
            "max_new_tokens": max_tokens,
            "temperature": temperature
        }
    }
    
    # Add system prompt if provided (Nova format)
    if system_prompt:
        request_body["system"] = [{"text": system_prompt}]
    
    # Retry logic with exponential backoff
    max_retries = 3
    base_delay = 1.0
    
    for attempt in range(max_retries):
        try:
            response = bedrock_runtime.invoke_model(
                modelId=BEDROCK_MODEL_ID,
                body=json.dumps(request_body)
            )
            
            # Parse response
            response_body = json.loads(response['body'].read())
            
            # Extract text from Nova response format
            output = response_body.get('output', {})
            message = output.get('message', {})
            content = message.get('content', [])
            
            if content and len(content) > 0:
                return content[0].get('text', '')
            else:
                raise Exception("Invalid response format from Bedrock")
                
        except ClientError as e:
            error_code = e.response['Error']['Code']
            
            # Check if we should retry
            if error_code in ['ThrottlingException', 'ServiceUnavailableException', 'TooManyRequestsException']:
                if attempt < max_retries - 1:
                    # Calculate delay with exponential backoff and jitter
                    delay = calculate_retry_delay(attempt, base_delay)
                    print(f"Bedrock call failed (attempt {attempt + 1}/{max_retries}), retrying in {delay:.2f}s: {error_code}")
                    time.sleep(delay)
                    continue
                else:
                    raise Exception(f"Bedrock unavailable after {max_retries} attempts: {error_code}")
            else:
                # Non-retryable error
                raise Exception(f"Bedrock error: {error_code} - {str(e)}")
        
        except Exception as e:
            if attempt < max_retries - 1:
                delay = calculate_retry_delay(attempt, base_delay)
                print(f"Bedrock call failed (attempt {attempt + 1}/{max_retries}), retrying in {delay:.2f}s: {str(e)}")
                time.sleep(delay)
                continue
            else:
                raise Exception(f"Bedrock call failed after {max_retries} attempts: {str(e)}")
    
    raise Exception("Bedrock call failed: max retries exceeded")
def calculate_retry_delay(attempt: int, base_delay: float = 1.0) -> float:
    """
    Calculate retry delay with exponential backoff and jitter
    
    Args:
        attempt: Retry attempt number (0-indexed)
        base_delay: Base delay in seconds
        
    Returns:
        Delay in seconds
    """
    # Exponential backoff: base_delay * 2^attempt
    exponential_delay = base_delay * (2 ** attempt)
    
    # Add jitter (random 0-25% of delay)
    jitter = random.uniform(0, exponential_delay * 0.25)
    
    return exponential_delay + jitter
def format_conversation_history(
    messages: List[Dict[str, str]],
    max_messages: int = 10
) -> List[Dict[str, str]]:
    """
    Format conversation history for Bedrock
    
    Args:
        messages: List of message dictionaries
        max_messages: Maximum number of messages to include
        
    Returns:
        Formatted messages for Bedrock API
    """
    # Take only the most recent messages
    recent_messages = messages[-max_messages:] if len(messages) > max_messages else messages
    
    # Format for Bedrock (ensure alternating user/assistant)
    formatted = []
    for msg in recent_messages:
        if 'role' in msg and 'content' in msg:
            formatted.append({
                "role": msg['role'],
                "content": msg['content']
            })
    
    return formatted


# Convenience function for testing
def test_bedrock_connection() -> bool:
    """
    Test Bedrock connection
    
    Returns:
        True if connection successful
    """
    try:
        response = invoke_bedrock(
            prompt="Hello, please respond with 'Connection successful'",
            temperature=0.1,
            max_tokens=50
        )
        print(f"Bedrock test response: {response}")
        return True
    except Exception as e:
        print(f"Bedrock connection test failed: {str(e)}")
        return False

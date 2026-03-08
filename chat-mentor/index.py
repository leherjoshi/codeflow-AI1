"""
Chat Mentor Lambda Function
Provides AI-powered mentoring with multi-step reasoning (budget-optimized)
"""

import json
import os
import re
from typing import Dict, Any, List
from datetime import datetime, timezone
import boto3

# Initialize AWS clients
dynamodb = boto3.resource('dynamodb')
bedrock_runtime = boto3.client('bedrock-runtime')

conversation_history_table = dynamodb.Table(os.environ['CONVERSATION_HISTORY_TABLE'])
llm_cache_table = dynamodb.Table(os.environ['LLM_CACHE_TABLE'])
users_table = dynamodb.Table(os.environ['USERS_TABLE'])

# Import LLM cache
try:
    from llm_cache import cache_bedrock_call
except ImportError:
    print("Warning: LLM cache not available, will use direct Bedrock calls")
    def cache_bedrock_call(query, bedrock_function, context, model_id):
        return {'response': bedrock_function(), 'cached': False}

# Import RAG functions (assuming RAG is deployed as a layer or in same package)
try:
    from rag.index import retrieve_knowledge
except ImportError:
    # Fallback if RAG not available
    def retrieve_knowledge(query, user_context=None, top_k=5):
        print("RAG not available, returning empty results")
        return []
def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Lambda handler for chat mentor endpoints
    
    Supported operations:
    - POST /chat-mentor: Send message to AI mentor
    - GET /chat-mentor/{user_id}/history: Get conversation history
    """
    
    try:
        http_method = event.get('httpMethod', '')
        path = event.get('path', '')
        body = json.loads(event.get('body', '{}')) if event.get('body') else {}
        path_parameters = event.get('pathParameters', {})
        
        # Handle OPTIONS request for CORS preflight
        if http_method == 'OPTIONS':
            return {
                'statusCode': 200,
                'headers': get_cors_headers(),
                'body': json.dumps({'message': 'CORS preflight successful'})
            }
        
        if http_method == 'POST' and '/chat-mentor' in path:
            return handle_chat_message(body)
        elif http_method == 'GET' and '/history' in path:
            user_id = path_parameters.get('user_id')
            return handle_get_history(user_id)
        else:
            return {
                'statusCode': 404,
                'headers': get_cors_headers(),
                'body': json.dumps({'error': 'Not found'})
            }
    
    except Exception as e:
        print(f"Error in chat mentor handler: {str(e)}")
        return {
            'statusCode': 500,
            'headers': get_cors_headers(),
            'body': json.dumps({'error': 'Internal server error'})
        }
def handle_chat_message(body: Dict[str, Any]) -> Dict[str, Any]:
    """
    Handle chat message from user
    
    Budget-optimized approach:
    1. Detect intent with regex (no Bedrock call)
    2. Check LLM cache (80% hit rate target)
    3. Use Claude Haiku for simple queries (10x cheaper)
    4. Use Claude Sonnet only for complex queries
    5. Store in conversation history
    
    Expected body:
    {
        "user_id": "string",
        "message": "string",
        "code": "string" (optional),
        "problem_id": "string" (optional)
    }
    """
    
    user_id = body.get('user_id')
    message = body.get('message', '')
    code = body.get('code')
    problem_id = body.get('problem_id')
    
    if not user_id or not message:
        return {
            'statusCode': 400,
            'headers': get_cors_headers(),
            'body': json.dumps({'error': 'Missing required fields'})
        }
    
    try:
        # Step 1: Detect intent (no Bedrock call - saves money)
        intent = detect_intent(message)
        
        # Step 2: Get user context
        user_context = get_user_context(user_id)
        
        # Step 3: Build context for cache key
        cache_context = {
            'user_id': user_id,
            'intent': intent,
            'has_code': bool(code)
        }
        
        # Step 4: Check cache and get response
        response_data = get_ai_response(
            message=message,
            intent=intent,
            code=code,
            user_context=user_context,
            cache_context=cache_context
        )
        
        # Step 5: Store in conversation history
        store_conversation(
            user_id=user_id,
            message=message,
            response=response_data['response'],
            intent=intent,
            cached=response_data.get('cached', False)
        )
        
        return {
            'statusCode': 200,
            'headers': get_cors_headers(),
            'body': json.dumps({
                'response': response_data['response'],
                'intent': intent,
                'cached': response_data.get('cached', False),
                'model_used': response_data.get('model_used', 'unknown')
            })
        }
    
    except Exception as e:
        print(f"Error handling chat message: {str(e)}")
        return {
            'statusCode': 500,
            'headers': get_cors_headers(),
            'body': json.dumps({
                'error': 'Failed to process message',
                'details': str(e)
            })
        }
def detect_intent(message: str) -> str:
    """
    Detect user intent using regex patterns (no Bedrock call - free!)
    
    Intents:
    - CODE_DEBUGGING: User has code issue
    - CONCEPT_QUESTION: Asking about algorithm/concept
    - HINT_REQUEST: Wants a hint
    - GENERAL: General question
    
    Args:
        message: User message
    
    Returns:
        Intent string
    """
    message_lower = message.lower()
    
    # Code debugging patterns
    if any(word in message_lower for word in ['error', 'bug', 'wrong', 'fail', 'debug', 'fix']):
        return 'CODE_DEBUGGING'
    
    # Hint request patterns
    if any(word in message_lower for word in ['hint', 'clue', 'help me start', 'stuck']):
        return 'HINT_REQUEST'
    
    # Concept question patterns
    if any(word in message_lower for word in ['what is', 'explain', 'how does', 'why', 'difference between']):
        return 'CONCEPT_QUESTION'
    
    # Default
    return 'GENERAL'
def get_user_context(user_id: str) -> Dict[str, Any]:
    """
    Get user context (weak topics, strong topics, level)
    
    Args:
        user_id: User ID
    
    Returns:
        User context dictionary
    """
    try:
        response = users_table.get_item(Key={'user_id': user_id})
        user_data = response.get('Item', {})
        
        leetcode_profile = user_data.get('leetcode_profile', {})
        topic_proficiency = leetcode_profile.get('topic_proficiency', {})
        
        # Extract weak and strong topics
        weak_topics = [
            topic for topic, data in topic_proficiency.items()
            if isinstance(data, dict) and data.get('classification') == 'weak'
        ]
        
        strong_topics = [
            topic for topic, data in topic_proficiency.items()
            if isinstance(data, dict) and data.get('classification') == 'strong'
        ]
        
        return {
            'weak_topics': weak_topics[:5],  # Top 5
            'strong_topics': strong_topics[:5],
            'total_solved': leetcode_profile.get('total_solved', 0)
        }
    
    except Exception as e:
        print(f"Error getting user context: {str(e)}")
        return {'weak_topics': [], 'strong_topics': [], 'total_solved': 0}
def get_ai_response(
    message: str,
    intent: str,
    code: str,
    user_context: Dict[str, Any],
    cache_context: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Get AI response with caching, RAG, and model selection
    
    Budget optimization:
    - Use cache first (80% hit rate = 80% cost savings)
    - Use RAG for concept questions (DynamoDB-based, no OpenSearch cost)
    - Use Claude Haiku for simple queries (10x cheaper)
    - Use Claude Sonnet only for complex code analysis
    
    Args:
        message: User message
        intent: Detected intent
        code: User code (optional)
        user_context: User context
        cache_context: Context for cache key
    
    Returns:
        Response dictionary with response text and metadata
    """
    
    # Step 1: Retrieve knowledge from RAG if needed
    rag_context = []
    if intent in ['CONCEPT_QUESTION', 'HINT_REQUEST']:
        try:
            rag_results = retrieve_knowledge(
                query=message,
                user_context=user_context,
                top_k=3  # Limit to 3 for cost optimization
            )
            rag_context = rag_results
            print(f"Retrieved {len(rag_context)} RAG results")
        except Exception as e:
            print(f"Error retrieving RAG context: {str(e)}")
            rag_context = []
    
    # Step 2: Select model (use Nova Lite for all queries - fast and cost-effective)
    model_id = 'apac.amazon.nova-lite-v1:0'
    
    # Step 3: Build prompt with RAG context
    prompt = build_prompt(message, intent, code, user_context, rag_context)
    
    # Step 4: Use cache wrapper
    def call_bedrock():
        return invoke_bedrock(prompt, model_id)
    
    response_data = cache_bedrock_call(
        query=message,
        bedrock_function=call_bedrock,
        context=cache_context,
        model_id=model_id
    )
    
    response_data['model_used'] = 'nova-lite'
    response_data['rag_results_count'] = len(rag_context)
    
    return response_data
def build_prompt(
    message: str,
    intent: str,
    code: str,
    user_context: Dict[str, Any],
    rag_context: List[Dict[str, Any]] = None
) -> str:
    """
    Build prompt for Bedrock with RAG context injection
    
    Args:
        message: User message
        intent: Detected intent
        code: User code (optional)
        user_context: User context
        rag_context: RAG retrieval results (optional)
    
    Returns:
        Formatted prompt
    """
    
    # Base system prompt
    system_prompt = """You are an expert programming mentor specializing in algorithms and data structures. 
Your goal is to guide students to understand concepts, not just give answers.

Guidelines:
- Be encouraging and supportive
- Ask guiding questions
- Explain concepts clearly
- Don't provide complete solutions
- Focus on understanding, not memorization
"""
    
    # Add user context
    if user_context.get('weak_topics'):
        system_prompt += f"\nStudent's weak areas: {', '.join(user_context['weak_topics'])}"
    
    # Inject RAG context if available
    if rag_context and len(rag_context) > 0:
        system_prompt += "\n\n**Knowledge Base Context:**\n"
        for i, result in enumerate(rag_context[:3], 1):  # Limit to top 3
            system_prompt += f"\n{i}. {result.get('title', 'Untitled')} (relevance: {result.get('score', 0):.2f})\n"
            system_prompt += f"{result.get('content', '')[:500]}...\n"  # Truncate for token limit
        system_prompt += "\nUse this context to provide accurate, grounded explanations.\n"
    
    # Build user message based on intent
    if intent == 'CODE_DEBUGGING' and code:
        user_message = f"""I'm working on a coding problem and need help debugging my code.

My question: {message}

My code:
```
{code}
```

Can you help me identify the issue and guide me to fix it?"""
    
    elif intent == 'HINT_REQUEST':
        user_message = f"""I'm stuck on a problem and need a hint (not the full solution).

{message}

Can you give me a hint to help me think about the approach?"""
    
    elif intent == 'CONCEPT_QUESTION':
        user_message = f"""I have a question about algorithms/data structures:

{message}

Can you explain this concept clearly?"""
    
    else:
        user_message = message
    
    # Combine system and user prompts
    full_prompt = f"""{system_prompt}

User: {user_message}

"""

    return full_prompt
def invoke_bedrock(prompt: str, model_id: str) -> str:
    """
    Invoke Bedrock API with Claude model

    Args:
        prompt: Formatted prompt
        model_id: Bedrock model ID

    Returns:
        Response text from Claude
    """
    try:
        # Build request body for Nova
        request_body = {
            "messages": [
                {
                    "role": "user",
                    "content": [{"text": prompt}]
                }
            ],
            "inferenceConfig": {
                "max_new_tokens": 2000,
                "temperature": 0.7
            }
        }

        # Invoke Bedrock with Nova
        response = bedrock_runtime.invoke_model(
            modelId=model_id,
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

        return "I'm sorry, I couldn't generate a response. Please try again."

    except Exception as e:
        print(f"Error invoking Bedrock: {str(e)}")
        raise
def store_conversation(
    user_id: str,
    message: str,
    response: str,
    intent: str,
    cached: bool
):
    """
    Store conversation in DynamoDB ConversationHistory table

    Args:
        user_id: User ID
        message: User message
        response: AI response
        intent: Detected intent
        cached: Whether response was cached
    """
    try:
        now = datetime.now(timezone.utc)
        conversation_id = f"{user_id}#{now.isoformat()}"

        conversation_history_table.put_item(
            Item={
                'conversation_id': conversation_id,
                'user_id': user_id,
                'message': message,
                'response': response,
                'intent': intent,
                'cached': cached,
                'timestamp': now.isoformat(),
                'ttl': int((now.timestamp()) + (30 * 24 * 60 * 60))  # 30 days TTL
            }
        )
        print(f"Stored conversation for user {user_id}")

    except Exception as e:
        print(f"Error storing conversation: {str(e)}")
        # Don't fail the request if storage fails
def handle_get_history(user_id: str) -> Dict[str, Any]:
    """
    Get conversation history for a user

    Args:
        user_id: User ID

    Returns:
        API Gateway response with conversation history
    """
    if not user_id:
        return {
            'statusCode': 400,
            'headers': get_cors_headers(),
            'body': json.dumps({'error': 'Missing user_id'})
        }

    try:
        # Query conversation history by user_id
        response = conversation_history_table.query(
            IndexName='user_id-index',
            KeyConditionExpression='user_id = :user_id',
            ExpressionAttributeValues={
                ':user_id': user_id
            },
            ScanIndexForward=False,  # Sort descending (most recent first)
            Limit=50  # Last 50 conversations
        )

        conversations = response.get('Items', [])

        # Format conversations for response
        formatted_conversations = []
        for conv in conversations:
            formatted_conversations.append({
                'message': conv.get('message'),
                'response': conv.get('response'),
                'intent': conv.get('intent'),
                'cached': conv.get('cached', False),
                'timestamp': conv.get('timestamp')
            })

        return {
            'statusCode': 200,
            'headers': get_cors_headers(),
            'body': json.dumps({
                'user_id': user_id,
                'conversations': formatted_conversations,
                'count': len(formatted_conversations)
            })
        }

    except Exception as e:
        print(f"Error fetching conversation history: {str(e)}")
        return {
            'statusCode': 500,
            'headers': get_cors_headers(),
            'body': json.dumps({
                'error': 'Failed to fetch conversation history',
                'details': str(e)
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


"""
Session management module for AI Interview Simulator

Handles CRUD operations for interview sessions in DynamoDB
"""

import os
import json
import gzip
from typing import Dict, Any, Optional
from datetime import datetime, timedelta
import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

from models import InterviewSession, SessionState

# Initialize AWS clients with connection pooling
dynamodb = boto3.resource('dynamodb', config=boto3.session.Config(
    max_pool_connections=50,
    retries={'max_attempts': 3, 'mode': 'adaptive'}
))
s3_client = boto3.client('s3')

# Environment variables
SESSIONS_TABLE = os.environ.get('INTERVIEW_SESSIONS_TABLE', 'codeflow-interview-sessions-dev')
S3_BUCKET = os.environ.get('S3_BUCKET', 'codeflow-interview-overflow')
SESSION_INACTIVITY_TIMEOUT = 120 * 60  # 120 minutes in seconds
MAX_SESSION_SIZE = 400 * 1024  # 400KB

# Get table reference
sessions_table = dynamodb.Table(SESSIONS_TABLE)
def create_session(session: InterviewSession) -> Dict[str, Any]:
    """
    Create a new interview session in DynamoDB
    
    Args:
        session: InterviewSession model instance
        
    Returns:
        Created session data
        
    Raises:
        Exception: If session creation fails
    """
    try:
        # Convert session to dict
        session_data = session.dict()
        
        # Store in DynamoDB
        sessions_table.put_item(
            Item=session_data,
            ConditionExpression='attribute_not_exists(session_id)'
        )
        
        print(f"Created session: {session.session_id} for user: {session.user_id}")
        return session_data
        
    except ClientError as e:
        if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
            raise Exception(f"Session {session.session_id} already exists")
        raise Exception(f"Failed to create session: {str(e)}")
    except Exception as e:
        raise Exception(f"Failed to create session: {str(e)}")
def get_session(session_id: str) -> Optional[InterviewSession]:
    """
    Retrieve an interview session from DynamoDB
    
    Args:
        session_id: Session identifier
        
    Returns:
        InterviewSession instance or None if not found
        
    Raises:
        Exception: If session retrieval fails
    """
    try:
        # Query by partition key (session_id)
        response = sessions_table.query(
            KeyConditionExpression=Key('session_id').eq(session_id),
            Limit=1
        )
        
        items = response.get('Items', [])
        if not items:
            return None
        
        session_data = items[0]
        
        # Check if session has overflow data in S3
        if session_data.get('s3_overflow_key'):
            session_data = _load_overflow_data(session_data)
        
        # Check for session expiration
        last_activity = session_data.get('last_activity_at', 0)
        if datetime.utcnow().timestamp() - last_activity > SESSION_INACTIVITY_TIMEOUT:
            # Mark session as expired
            update_session_state(session_id, SessionState.EXPIRED)
            session_data['session_state'] = SessionState.EXPIRED.value
        
        return InterviewSession(**session_data)
        
    except Exception as e:
        raise Exception(f"Failed to get session {session_id}: {str(e)}")
def update_session(session: InterviewSession) -> Dict[str, Any]:
    """
    Update an existing interview session in DynamoDB
    
    Args:
        session: Updated InterviewSession instance
        
    Returns:
        Updated session data
        
    Raises:
        Exception: If session update fails
    """
    try:
        # Update last_activity_at
        session.last_activity_at = int(datetime.utcnow().timestamp())
        
        # Convert to dict
        session_data = session.dict()
        
        # Check session size and handle overflow
        session_size = len(json.dumps(session_data).encode('utf-8'))
        if session_size > MAX_SESSION_SIZE:
            session_data = _handle_overflow(session_data)
        
        # Update in DynamoDB
        sessions_table.put_item(Item=session_data)
        
        print(f"Updated session: {session.session_id}")
        return session_data
        
    except Exception as e:
        raise Exception(f"Failed to update session {session.session_id}: {str(e)}")
def update_session_state(session_id: str, new_state: SessionState) -> None:
    """
    Update session state
    
    Args:
        session_id: Session identifier
        new_state: New session state
        
    Raises:
        Exception: If state update fails
    """
    try:
        # Get current timestamp for the sort key
        timestamp = int(datetime.utcnow().timestamp())
        
        sessions_table.update_item(
            Key={
                'session_id': session_id,
                'timestamp': timestamp
            },
            UpdateExpression='SET session_state = :state, last_activity_at = :now',
            ExpressionAttributeValues={
                ':state': new_state.value,
                ':now': timestamp
            }
        )
        
        print(f"Updated session {session_id} state to {new_state.value}")
        
    except Exception as e:
        raise Exception(f"Failed to update session state: {str(e)}")
def _handle_overflow(session_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Handle session data overflow by storing large content in S3
    
    Args:
        session_data: Session data dictionary
        
    Returns:
        Modified session data with S3 reference
    """
    try:
        session_id = session_data['session_id']
        
        # Extract large fields for S3 storage
        overflow_data = {
            'code_solutions': session_data.get('code_solutions', []),
            'evaluations': session_data.get('evaluations', []),
            'conversation_history': session_data.get('conversation_history', []),
            'feedback_report': session_data.get('feedback_report')
        }
        
        # Compress overflow data
        compressed_data = gzip.compress(json.dumps(overflow_data).encode('utf-8'))
        
        # Store in S3
        s3_key = f"interview-sessions/{session_id}/overflow.json.gz"
        s3_client.put_object(
            Bucket=S3_BUCKET,
            Key=s3_key,
            Body=compressed_data,
            ContentType='application/json',
            ContentEncoding='gzip'
        )
        
        # Remove large fields from DynamoDB record
        session_data['code_solutions'] = []
        session_data['evaluations'] = []
        session_data['conversation_history'] = []
        session_data['feedback_report'] = None
        session_data['s3_overflow_key'] = s3_key
        
        print(f"Stored overflow data for session {session_id} in S3: {s3_key}")
        return session_data
        
    except Exception as e:
        print(f"Error handling overflow: {str(e)}")
        # Return original data if overflow handling fails
        return session_data
def _load_overflow_data(session_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Load overflow data from S3 and merge with session data
    
    Args:
        session_data: Session data with S3 reference
        
    Returns:
        Complete session data with overflow content
    """
    try:
        s3_key = session_data.get('s3_overflow_key')
        if not s3_key:
            return session_data
        
        # Fetch from S3
        response = s3_client.get_object(Bucket=S3_BUCKET, Key=s3_key)
        compressed_data = response['Body'].read()
        
        # Decompress
        decompressed_data = gzip.decompress(compressed_data)
        overflow_data = json.loads(decompressed_data.decode('utf-8'))
        
        # Merge overflow data back
        session_data.update(overflow_data)
        
        return session_data
        
    except Exception as e:
        print(f"Error loading overflow data: {str(e)}")
        # Return session data without overflow if loading fails
        return session_data
def get_user_sessions(user_id: str, limit: int = 10) -> list:
    """
    Get recent sessions for a user
    
    Args:
        user_id: User identifier
        limit: Maximum number of sessions to return
        
    Returns:
        List of session data dictionaries
    """
    try:
        response = sessions_table.query(
            IndexName='user-id-index',
            KeyConditionExpression=Key('user_id').eq(user_id),
            ScanIndexForward=False,  # Sort by timestamp descending
            Limit=limit
        )
        
        return response.get('Items', [])
        
    except Exception as e:
        print(f"Error fetching user sessions: {str(e)}")
        return []

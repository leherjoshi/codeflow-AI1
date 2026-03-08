"""
Authentication module for AI Interview Simulator

Handles JWT validation and session ownership verification
"""

import os
import json
from typing import Dict, Any, Optional, Tuple
import jwt
import boto3

# Environment variables
JWT_SECRET = os.environ.get('JWT_SECRET', 'PLACEHOLDER_JWT_SECRET_CHANGE_IN_PRODUCTION')
JWT_ALGORITHM = 'HS256'

# Initialize CloudWatch client for logging
cloudwatch = boto3.client('logs')
LOG_GROUP = os.environ.get('LOG_GROUP', '/aws/lambda/interview-simulator')
def validate_jwt_token(event: Dict[str, Any]) -> Tuple[Optional[str], Optional[Dict[str, Any]]]:
    """
    Validate JWT token from API Gateway event and extract user_id
    
    Args:
        event: API Gateway event containing headers
        
    Returns:
        Tuple of (user_id, error_response)
        - If valid: (user_id, None)
        - If invalid: (None, error_response_dict)
    """
    try:
        # Extract Authorization header
        headers = event.get('headers', {})
        auth_header = headers.get('Authorization') or headers.get('authorization')
        
        if not auth_header:
            return None, {
                'statusCode': 401,
                'headers': get_cors_headers(),
                'body': json.dumps({
                    'error': 'Missing authorization token',
                    'error_code': 'MISSING_TOKEN'
                })
            }
        
        # Extract token from "Bearer <token>" format
        parts = auth_header.split()
        if len(parts) != 2 or parts[0].lower() != 'bearer':
            return None, {
                'statusCode': 401,
                'headers': get_cors_headers(),
                'body': json.dumps({
                    'error': 'Invalid authorization header format',
                    'error_code': 'INVALID_AUTH_FORMAT'
                })
            }
        
        token = parts[1]
        
        # Verify and decode token
        try:
            payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
            
            # Verify token type
            if payload.get('token_type') != 'access':
                log_authentication_failure(
                    user_id=payload.get('user_id'),
                    error_type='INVALID_TOKEN_TYPE',
                    request_id=event.get('requestContext', {}).get('requestId')
                )
                return None, {
                    'statusCode': 401,
                    'headers': get_cors_headers(),
                    'body': json.dumps({
                        'error': 'Invalid token type',
                        'error_code': 'INVALID_TOKEN_TYPE'
                    })
                }
            
            user_id = payload.get('user_id')
            if not user_id:
                return None, {
                    'statusCode': 401,
                    'headers': get_cors_headers(),
                    'body': json.dumps({
                        'error': 'Invalid token payload',
                        'error_code': 'INVALID_PAYLOAD'
                    })
                }
            
            return user_id, None
            
        except jwt.ExpiredSignatureError:
            log_authentication_failure(
                user_id=None,
                error_type='EXPIRED_TOKEN',
                request_id=event.get('requestContext', {}).get('requestId')
            )
            return None, {
                'statusCode': 401,
                'headers': get_cors_headers(),
                'body': json.dumps({
                    'error': 'Token has expired',
                    'error_code': 'EXPIRED_TOKEN'
                })
            }
        except jwt.InvalidTokenError as e:
            log_authentication_failure(
                user_id=None,
                error_type='INVALID_TOKEN',
                request_id=event.get('requestContext', {}).get('requestId'),
                details=str(e)
            )
            return None, {
                'statusCode': 401,
                'headers': get_cors_headers(),
                'body': json.dumps({
                    'error': 'Invalid token',
                    'error_code': 'INVALID_TOKEN'
                })
            }
    
    except Exception as e:
        print(f"Error validating JWT token: {str(e)}")
        return None, {
            'statusCode': 500,
            'headers': get_cors_headers(),
            'body': json.dumps({
                'error': 'Authentication error',
                'error_code': 'AUTH_ERROR'
            })
        }
def verify_session_ownership(user_id: str, session_user_id: str, request_id: str) -> Optional[Dict[str, Any]]:
    """
    Verify that the authenticated user owns the session
    
    Args:
        user_id: Authenticated user ID from JWT
        session_user_id: User ID from session record
        request_id: Request ID for logging
        
    Returns:
        None if authorized, error response dict if unauthorized
    """
    if user_id != session_user_id:
        log_authentication_failure(
            user_id=user_id,
            error_type='UNAUTHORIZED_ACCESS',
            request_id=request_id,
            details=f"Attempted to access session owned by {session_user_id}"
        )
        return {
            'statusCode': 403,
            'headers': get_cors_headers(),
            'body': json.dumps({
                'error': 'Unauthorized access to session',
                'error_code': 'UNAUTHORIZED'
            })
        }
    
    return None


def log_authentication_failure(
    user_id: Optional[str],
    error_type: str,
    request_id: Optional[str],
    details: Optional[str] = None
) -> None:
    """
    Log authentication failures to CloudWatch
    
    Args:
        user_id: User ID if available
        error_type: Type of authentication error
        request_id: API Gateway request ID
        details: Additional error details
    """
    try:
        log_entry = {
            'event_type': 'authentication_failure',
            'user_id': user_id or 'unknown',
            'error_type': error_type,
            'request_id': request_id or 'unknown',
            'details': details or ''
        }
        print(f"AUTH_FAILURE: {json.dumps(log_entry)}")
    except Exception as e:
        print(f"Error logging authentication failure: {str(e)}")


def get_cors_headers() -> Dict[str, str]:
    """Return CORS headers for API responses"""
    return {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Request-ID',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
    }

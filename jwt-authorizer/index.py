"""
JWT Authorizer Lambda Function
Validates JWT tokens for API Gateway requests
"""

import json
import os
import jwt
from datetime import datetime

JWT_SECRET = os.environ.get('JWT_SECRET', 'PLACEHOLDER_JWT_SECRET_CHANGE_IN_PRODUCTION')
JWT_ALGORITHM = 'HS256'

def handler(event, context):
    """Lambda authorizer for JWT validation"""
    
    # Extract token from Authorization header
    # API Gateway passes headers in different formats depending on authorizer type
    token = None
    
    # Try different header formats
    if 'authorizationToken' in event:
        # TOKEN authorizer format
        token = event['authorizationToken']
    elif 'headers' in event:
        # REQUEST authorizer format
        headers = event['headers']
        token = headers.get('Authorization') or headers.get('authorization')
    
    print(f"Event keys: {event.keys()}")
    print(f"Token found: {token is not None}")
    
    if not token:
        print("No token found in request")
        raise Exception('Unauthorized')
    
    # Remove 'Bearer ' prefix if present
    if token.startswith('Bearer '):
        token = token[7:]
    elif token.startswith('bearer '):
        token = token[7:]
    
    try:
        # Decode and validate JWT
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        
        # Check token type
        if payload.get('token_type') != 'access':
            print("Invalid token type")
            raise Exception('Unauthorized')
        
        # Extract user info
        user_id = payload.get('user_id')
        leetcode_username = payload.get('leetcode_username')
        
        if not user_id:
            print("No user_id in token")
            raise Exception('Unauthorized')
        
        # Generate IAM policy
        policy = {
            'principalId': user_id,
            'policyDocument': {
                'Version': '2012-10-17',
                'Statement': [
                    {
                        'Action': 'execute-api:Invoke',
                        'Effect': 'Allow',
                        'Resource': event.get('methodArn', '*')
                    }
                ]
            },
            'context': {
                'user_id': user_id,
                'leetcode_username': leetcode_username or '',
                'rate_limit_key': user_id
            }
        }
        
        print(f"Authorization successful for user: {user_id}")
        return policy
        
    except jwt.ExpiredSignatureError:
        print("Token has expired")
        raise Exception('Unauthorized')
    except jwt.InvalidTokenError as e:
        print(f"Invalid token: {str(e)}")
        raise Exception('Unauthorized')
    except Exception as e:
        print(f"Authorization error: {str(e)}")
        raise Exception('Unauthorized')

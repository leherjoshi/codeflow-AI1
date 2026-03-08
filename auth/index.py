"""
Auth Lambda Function
Handles user authentication: registration, login, JWT token generation
"""

import json
import os
import uuid
import hashlib
import re
from datetime import datetime, timedelta
from typing import Dict, Any, Optional
import jwt
import boto3
from boto3.dynamodb.conditions import Key, Attr

# Initialize AWS clients
dynamodb = boto3.resource('dynamodb')
users_table = dynamodb.Table(os.environ['USERS_TABLE'])

# Environment variables
JWT_SECRET = os.environ.get('JWT_SECRET', 'PLACEHOLDER_JWT_SECRET_CHANGE_IN_PRODUCTION')
JWT_ALGORITHM = 'HS256'
ACCESS_TOKEN_EXPIRE_HOURS = 24
REFRESH_TOKEN_EXPIRE_DAYS = 30
ENVIRONMENT = os.environ.get('ENVIRONMENT', 'dev')


# Simple validation functions
def validate_email(email: str) -> bool:
    """Validate email format"""
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return bool(re.match(pattern, email))


def validate_register_request(body: Dict[str, Any]) -> tuple[bool, Optional[str]]:
    """Validate registration request"""
    if 'leetcode_username' not in body or not body['leetcode_username']:
        return False, 'leetcode_username is required'
    if 'email' not in body or not validate_email(body['email']):
        return False, 'valid email is required'
    if 'password' not in body or len(body['password']) < 8:
        return False, 'password must be at least 8 characters'
    if 'language_preference' in body and body['language_preference'] not in ['en', 'hi']:
        return False, 'language_preference must be en or hi'
    return True, None


def validate_login_request(body: Dict[str, Any]) -> tuple[bool, Optional[str]]:
    """Validate login request"""
    if 'leetcode_username' not in body or not body['leetcode_username']:
        return False, 'leetcode_username is required'
    if 'password' not in body or not body['password']:
        return False, 'password is required'
    return True, None


def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Lambda handler for authentication endpoints
    
    Supported operations:
    - POST /auth/register: Register new user
    - POST /auth/login: Login user and generate JWT
    - POST /auth/refresh: Refresh JWT token
    """
    
    try:
        # Parse request
        http_method = event.get('httpMethod', '')
        path = event.get('path', '')
        body_str = event.get('body', '{}')
        
        # Handle OPTIONS for CORS preflight
        if http_method == 'OPTIONS':
            return {
                'statusCode': 200,
                'headers': get_cors_headers(),
                'body': ''
            }
        
        # Route to appropriate handler
        if http_method == 'POST' and path.endswith('/register'):
            return handle_register(body_str)
        elif http_method == 'POST' and path.endswith('/login'):
            return handle_login(body_str)
        elif http_method == 'POST' and path.endswith('/refresh'):
            return handle_refresh(body_str)
        else:
            return {
                'statusCode': 404,
                'headers': get_cors_headers(),
                'body': json.dumps({'error': 'Not found'})
            }
    
    except Exception as e:
        print(f"Error in auth handler: {str(e)}")
        return {
            'statusCode': 500,
            'headers': get_cors_headers(),
            'body': json.dumps({'error': 'Internal server error'})
        }


def handle_register(body_str: str) -> Dict[str, Any]:
    """
    Handle user registration
    
    Expected body:
    {
        "leetcode_username": "string",
        "email": "string",
        "password": "string",
        "language_preference": "en" | "hi"
    }
    """
    
    try:
        # Parse and validate request
        body = json.loads(body_str)
        valid, error = validate_register_request(body)
        if not valid:
            return {
                'statusCode': 400,
                'headers': get_cors_headers(),
                'body': json.dumps({'error': error})
            }
        
        leetcode_username = body['leetcode_username']
        email = body['email']
        password = body['password']
        language_preference = body.get('language_preference', 'en')
        
        # Check if user already exists by leetcode_username
        existing_user = check_user_exists(leetcode_username)
        if existing_user:
            return {
                'statusCode': 409,
                'headers': get_cors_headers(),
                'body': json.dumps({'error': 'User with this LeetCode username already exists'})
            }
        
        # Hash password
        password_hash = hash_password(password)
        
        # Generate user ID
        user_id = str(uuid.uuid4())
        
        # Create user record
        now = datetime.utcnow().isoformat()
        user_item = {
            'user_id': user_id,
            'leetcode_username': leetcode_username,
            'email': email,
            'password_hash': password_hash,
            'language_preference': language_preference,
            'created_at': now,
            'last_login': now,
            'profile_data': {
                'total_solved': 0,
                'easy_solved': 0,
                'medium_solved': 0,
                'hard_solved': 0,
                'topic_proficiency': {},
                'recent_submissions': [],
                'last_synced': None
            }
        }
        
        # Store in DynamoDB
        users_table.put_item(
            Item=user_item,
            ConditionExpression='attribute_not_exists(user_id)'
        )
        
        # Generate tokens
        access_token = generate_access_token(user_id, leetcode_username)
        refresh_token = generate_refresh_token(user_id)
        
        return {
            'statusCode': 201,
            'headers': get_cors_headers(),
            'body': json.dumps({
                'user_id': user_id,
                'access_token': access_token,
                'refresh_token': refresh_token,
                'expires_in': ACCESS_TOKEN_EXPIRE_HOURS * 3600
            })
        }
    
    except json.JSONDecodeError:
        return {
            'statusCode': 400,
            'headers': get_cors_headers(),
            'body': json.dumps({'error': 'Invalid JSON'})
        }
    except Exception as e:
        print(f"Error in handle_register: {str(e)}")
        return {
            'statusCode': 500,
            'headers': get_cors_headers(),
            'body': json.dumps({'error': 'Registration failed'})
        }


def handle_login(body_str: str) -> Dict[str, Any]:
    """
    Handle user login
    
    Expected body:
    {
        "leetcode_username": "string",
        "password": "string"
    }
    """
    
    try:
        # Parse and validate request
        body = json.loads(body_str)
        valid, error = validate_login_request(body)
        if not valid:
            return {
                'statusCode': 400,
                'headers': get_cors_headers(),
                'body': json.dumps({'error': error})
            }
        
        leetcode_username = body['leetcode_username']
        password = body['password']
        
        # Fetch user from DynamoDB by leetcode_username
        user = get_user_by_leetcode_username(leetcode_username)
        
        if not user:
            return {
                'statusCode': 401,
                'headers': get_cors_headers(),
                'body': json.dumps({'error': 'Invalid credentials'})
            }
        
        # Verify password
        if not verify_password(password, user['password_hash']):
            return {
                'statusCode': 401,
                'headers': get_cors_headers(),
                'body': json.dumps({'error': 'Invalid credentials'})
            }
        
        # Update last login
        users_table.update_item(
            Key={'user_id': user['user_id']},
            UpdateExpression='SET last_login = :now',
            ExpressionAttributeValues={':now': datetime.utcnow().isoformat()}
        )
        
        # Generate tokens
        access_token = generate_access_token(user['user_id'], user['leetcode_username'])
        refresh_token = generate_refresh_token(user['user_id'])
        
        return {
            'statusCode': 200,
            'headers': get_cors_headers(),
            'body': json.dumps({
                'access_token': access_token,
                'refresh_token': refresh_token,
                'user': {
                    'user_id': user['user_id'],
                    'leetcode_username': user['leetcode_username'],
                    'language_preference': user.get('language_preference', 'en')
                }
            })
        }
    
    except json.JSONDecodeError:
        return {
            'statusCode': 400,
            'headers': get_cors_headers(),
            'body': json.dumps({'error': 'Invalid JSON'})
        }
    except Exception as e:
        print(f"Error in handle_login: {str(e)}")
        return {
            'statusCode': 500,
            'headers': get_cors_headers(),
            'body': json.dumps({'error': 'Login failed'})
        }


def handle_refresh(body_str: str) -> Dict[str, Any]:
    """
    Handle JWT token refresh
    
    Expected body:
    {
        "refresh_token": "string"
    }
    """
    
    try:
        # Parse and validate request
        body = json.loads(body_str)
        if 'refresh_token' not in body:
            return {
                'statusCode': 400,
                'headers': get_cors_headers(),
                'body': json.dumps({'error': 'refresh_token is required'})
            }
        
        refresh_token = body['refresh_token']
        
        # Verify refresh token
        payload = verify_token(refresh_token, token_type='refresh')
        
        if not payload:
            return {
                'statusCode': 401,
                'headers': get_cors_headers(),
                'body': json.dumps({'error': 'Invalid or expired refresh token'})
            }
        
        user_id = payload.get('user_id')
        
        # Fetch user to get leetcode_username
        response = users_table.get_item(Key={'user_id': user_id})
        user = response.get('Item')
        
        if not user:
            return {
                'statusCode': 401,
                'headers': get_cors_headers(),
                'body': json.dumps({'error': 'User not found'})
            }
        
        # Generate new access token
        access_token = generate_access_token(user_id, user['leetcode_username'])
        
        return {
            'statusCode': 200,
            'headers': get_cors_headers(),
            'body': json.dumps({
                'access_token': access_token,
                'expires_in': ACCESS_TOKEN_EXPIRE_HOURS * 3600
            })
        }
    
    except json.JSONDecodeError:
        return {
            'statusCode': 400,
            'headers': get_cors_headers(),
            'body': json.dumps({'error': 'Invalid JSON'})
        }
    except Exception as e:
        print(f"Error in handle_refresh: {str(e)}")
        return {
            'statusCode': 500,
            'headers': get_cors_headers(),
            'body': json.dumps({'error': 'Token refresh failed'})
        }


# Helper functions

def hash_password(password: str) -> str:
    """Hash password using SHA256 with salt"""
    salt = os.urandom(32)
    password_hash = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, 100000)
    # Store salt + hash
    return salt.hex() + ':' + password_hash.hex()


def verify_password(password: str, stored_hash: str) -> bool:
    """Verify password against hash"""
    try:
        salt_hex, hash_hex = stored_hash.split(':')
        salt = bytes.fromhex(salt_hex)
        password_hash = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, 100000)
        return password_hash.hex() == hash_hex
    except Exception as e:
        print(f"Error verifying password: {str(e)}")
        return False


def generate_access_token(user_id: str, leetcode_username: str) -> str:
    """Generate JWT access token"""
    payload = {
        'user_id': user_id,
        'leetcode_username': leetcode_username,
        'token_type': 'access',
        'exp': datetime.utcnow() + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS),
        'iat': datetime.utcnow()
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def generate_refresh_token(user_id: str) -> str:
    """Generate JWT refresh token"""
    payload = {
        'user_id': user_id,
        'token_type': 'refresh',
        'exp': datetime.utcnow() + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS),
        'iat': datetime.utcnow()
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def verify_token(token: str, token_type: str = 'access') -> Optional[Dict[str, Any]]:
    """Verify JWT token and return payload"""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        
        # Verify token type
        if payload.get('token_type') != token_type:
            return None
        
        return payload
    except jwt.ExpiredSignatureError:
        print("Token has expired")
        return None
    except jwt.InvalidTokenError as e:
        print(f"Invalid token: {str(e)}")
        return None


def check_user_exists(leetcode_username: str) -> bool:
    """Check if user exists by leetcode_username"""
    try:
        response = users_table.query(
            IndexName='leetcode-username-index',
            KeyConditionExpression=Key('leetcode_username').eq(leetcode_username),
            Limit=1
        )
        return len(response.get('Items', [])) > 0
    except Exception as e:
        print(f"Error checking user existence: {str(e)}")
        return False


def get_user_by_leetcode_username(leetcode_username: str) -> Optional[Dict[str, Any]]:
    """Get user by leetcode_username"""
    try:
        response = users_table.query(
            IndexName='leetcode-username-index',
            KeyConditionExpression=Key('leetcode_username').eq(leetcode_username),
            Limit=1
        )
        items = response.get('Items', [])
        return items[0] if items else None
    except Exception as e:
        print(f"Error fetching user: {str(e)}")
        return None


def get_cors_headers() -> Dict[str, str]:
    """Return CORS headers for API responses"""
    return {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Request-ID',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
    }

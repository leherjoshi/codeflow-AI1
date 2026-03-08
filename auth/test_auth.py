"""
Unit tests for authentication service
Tests registration, login, JWT generation, and password hashing
"""

import json
import os
import sys
import pytest
from unittest.mock import Mock, patch, MagicMock
from datetime import datetime, timedelta
import jwt
import bcrypt

# Set environment variables before importing the module
os.environ['USERS_TABLE'] = 'test-users-table'
os.environ['JWT_SECRET'] = 'test-secret-key'
os.environ['ENVIRONMENT'] = 'test'
os.environ['AWS_DEFAULT_REGION'] = 'us-east-1'

# Mock aws_xray_sdk before importing
mock_xray = MagicMock()
mock_xray.core.xray_recorder.capture = lambda name: lambda f: f
sys.modules['aws_xray_sdk'] = mock_xray
sys.modules['aws_xray_sdk.core'] = mock_xray.core

# Mock boto3 properly
mock_boto3 = MagicMock()
mock_dynamodb = MagicMock()
mock_table = MagicMock()
mock_boto3.resource.return_value = mock_dynamodb
mock_dynamodb.Table.return_value = mock_table
sys.modules['boto3'] = mock_boto3
sys.modules['boto3.dynamodb'] = MagicMock()
sys.modules['boto3.dynamodb.conditions'] = MagicMock()

# Import Key and Attr for mocking
from unittest.mock import MagicMock as Key, MagicMock as Attr

# Import after setting env vars and mocks
import index


class TestPasswordHashing:
    """Test password hashing and verification"""
    
    def test_hash_password_creates_valid_hash(self):
        """Test that password hashing creates a valid bcrypt hash"""
        password = "test_password_123"
        hashed = index.hash_password(password)
        
        # Verify it's a valid bcrypt hash
        assert hashed.startswith('$2b$')
        assert len(hashed) == 60
    
    def test_verify_password_with_correct_password(self):
        """Test password verification with correct password"""
        password = "test_password_123"
        hashed = index.hash_password(password)
        
        assert index.verify_password(password, hashed) is True
    
    def test_verify_password_with_incorrect_password(self):
        """Test password verification with incorrect password"""
        password = "test_password_123"
        wrong_password = "wrong_password"
        hashed = index.hash_password(password)
        
        assert index.verify_password(wrong_password, hashed) is False


class TestJWTTokens:
    """Test JWT token generation and validation"""
    
    def test_generate_access_token(self):
        """Test access token generation"""
        user_id = "test-user-id"
        leetcode_username = "test_user"
        
        token = index.generate_access_token(user_id, leetcode_username)
        
        # Decode and verify
        payload = jwt.decode(token, os.environ['JWT_SECRET'], algorithms=['HS256'])
        assert payload['user_id'] == user_id
        assert payload['leetcode_username'] == leetcode_username
        assert payload['token_type'] == 'access'
    
    def test_generate_refresh_token(self):
        """Test refresh token generation"""
        user_id = "test-user-id"
        
        token = index.generate_refresh_token(user_id)
        
        # Decode and verify
        payload = jwt.decode(token, os.environ['JWT_SECRET'], algorithms=['HS256'])
        assert payload['user_id'] == user_id
        assert payload['token_type'] == 'refresh'
    
    def test_verify_valid_token(self):
        """Test verification of valid token"""
        user_id = "test-user-id"
        leetcode_username = "test_user"
        token = index.generate_access_token(user_id, leetcode_username)
        
        payload = index.verify_token(token, token_type='access')
        
        assert payload is not None
        assert payload['user_id'] == user_id
    
    def test_verify_expired_token(self):
        """Test verification of expired token"""
        # Create an expired token
        payload = {
            'user_id': 'test-user-id',
            'token_type': 'access',
            'exp': datetime.utcnow() - timedelta(hours=1),
            'iat': datetime.utcnow() - timedelta(hours=2)
        }
        token = jwt.encode(payload, os.environ['JWT_SECRET'], algorithm='HS256')
        
        result = index.verify_token(token, token_type='access')
        
        assert result is None
    
    def test_verify_wrong_token_type(self):
        """Test verification fails for wrong token type"""
        user_id = "test-user-id"
        token = index.generate_refresh_token(user_id)
        
        # Try to verify as access token
        payload = index.verify_token(token, token_type='access')
        
        assert payload is None


class TestRegistrationEndpoint:
    """Test user registration endpoint"""
    
    @patch('index.users_table')
    @patch('index.check_user_exists')
    def test_successful_registration(self, mock_check_exists, mock_table):
        """Test successful user registration"""
        mock_check_exists.return_value = False
        mock_table.put_item = Mock()
        
        event = {
            'httpMethod': 'POST',
            'path': '/auth/register',
            'body': json.dumps({
                'leetcode_username': 'new_user',
                'email': 'test@example.com',
                'password': 'password123',
                'language_preference': 'en'
            })
        }
        
        response = index.handler(event, None)
        
        assert response['statusCode'] == 201
        body = json.loads(response['body'])
        assert 'user_id' in body
        assert 'access_token' in body
        assert 'refresh_token' in body
        assert body['expires_in'] == 24 * 3600
    
    @patch('index.check_user_exists')
    def test_registration_with_existing_username(self, mock_check_exists):
        """Test registration fails when username already exists"""
        mock_check_exists.return_value = True
        
        event = {
            'httpMethod': 'POST',
            'path': '/auth/register',
            'body': json.dumps({
                'leetcode_username': 'existing_user',
                'email': 'test@example.com',
                'password': 'password123'
            })
        }
        
        response = index.handler(event, None)
        
        assert response['statusCode'] == 409
        body = json.loads(response['body'])
        assert 'error' in body
    
    def test_registration_with_invalid_email(self):
        """Test registration fails with invalid email"""
        event = {
            'httpMethod': 'POST',
            'path': '/auth/register',
            'body': json.dumps({
                'leetcode_username': 'new_user',
                'email': 'invalid-email',
                'password': 'password123'
            })
        }
        
        response = index.handler(event, None)
        
        assert response['statusCode'] == 400
        body = json.loads(response['body'])
        assert 'error' in body
    
    def test_registration_with_short_password(self):
        """Test registration fails with password less than 8 characters"""
        event = {
            'httpMethod': 'POST',
            'path': '/auth/register',
            'body': json.dumps({
                'leetcode_username': 'new_user',
                'email': 'test@example.com',
                'password': 'short'
            })
        }
        
        response = index.handler(event, None)
        
        assert response['statusCode'] == 400


class TestLoginEndpoint:
    """Test user login endpoint"""
    
    @patch('index.users_table')
    @patch('index.get_user_by_leetcode_username')
    def test_successful_login(self, mock_get_user, mock_table):
        """Test successful login"""
        password = "password123"
        password_hash = index.hash_password(password)
        
        mock_get_user.return_value = {
            'user_id': 'test-user-id',
            'leetcode_username': 'test_user',
            'password_hash': password_hash,
            'language_preference': 'en'
        }
        mock_table.update_item = Mock()
        
        event = {
            'httpMethod': 'POST',
            'path': '/auth/login',
            'body': json.dumps({
                'leetcode_username': 'test_user',
                'password': password
            })
        }
        
        response = index.handler(event, None)
        
        assert response['statusCode'] == 200
        body = json.loads(response['body'])
        assert 'access_token' in body
        assert 'refresh_token' in body
        assert 'user' in body
        assert body['user']['user_id'] == 'test-user-id'
    
    @patch('index.get_user_by_leetcode_username')
    def test_login_with_nonexistent_user(self, mock_get_user):
        """Test login fails with nonexistent user"""
        mock_get_user.return_value = None
        
        event = {
            'httpMethod': 'POST',
            'path': '/auth/login',
            'body': json.dumps({
                'leetcode_username': 'nonexistent',
                'password': 'password123'
            })
        }
        
        response = index.handler(event, None)
        
        assert response['statusCode'] == 401
        body = json.loads(response['body'])
        assert body['error'] == 'Invalid credentials'
    
    @patch('index.get_user_by_leetcode_username')
    def test_login_with_wrong_password(self, mock_get_user):
        """Test login fails with wrong password"""
        password_hash = index.hash_password("correct_password")
        
        mock_get_user.return_value = {
            'user_id': 'test-user-id',
            'leetcode_username': 'test_user',
            'password_hash': password_hash
        }
        
        event = {
            'httpMethod': 'POST',
            'path': '/auth/login',
            'body': json.dumps({
                'leetcode_username': 'test_user',
                'password': 'wrong_password'
            })
        }
        
        response = index.handler(event, None)
        
        assert response['statusCode'] == 401
        body = json.loads(response['body'])
        assert body['error'] == 'Invalid credentials'


class TestRefreshEndpoint:
    """Test token refresh endpoint"""
    
    @patch('index.users_table')
    def test_successful_token_refresh(self, mock_table):
        """Test successful token refresh"""
        user_id = 'test-user-id'
        refresh_token = index.generate_refresh_token(user_id)
        
        mock_table.get_item.return_value = {
            'Item': {
                'user_id': user_id,
                'leetcode_username': 'test_user'
            }
        }
        
        event = {
            'httpMethod': 'POST',
            'path': '/auth/refresh',
            'body': json.dumps({
                'refresh_token': refresh_token
            })
        }
        
        response = index.handler(event, None)
        
        assert response['statusCode'] == 200
        body = json.loads(response['body'])
        assert 'access_token' in body
        assert body['expires_in'] == 24 * 3600
    
    def test_refresh_with_invalid_token(self):
        """Test refresh fails with invalid token"""
        event = {
            'httpMethod': 'POST',
            'path': '/auth/refresh',
            'body': json.dumps({
                'refresh_token': 'invalid-token'
            })
        }
        
        response = index.handler(event, None)
        
        assert response['statusCode'] == 401
    
    def test_refresh_with_access_token(self):
        """Test refresh fails when using access token instead of refresh token"""
        user_id = 'test-user-id'
        access_token = index.generate_access_token(user_id, 'test_user')
        
        event = {
            'httpMethod': 'POST',
            'path': '/auth/refresh',
            'body': json.dumps({
                'refresh_token': access_token
            })
        }
        
        response = index.handler(event, None)
        
        assert response['statusCode'] == 401


class TestCORS:
    """Test CORS handling"""
    
    def test_options_request(self):
        """Test OPTIONS request for CORS preflight"""
        event = {
            'httpMethod': 'OPTIONS',
            'path': '/auth/register'
        }
        
        response = index.handler(event, None)
        
        assert response['statusCode'] == 200
        assert 'Access-Control-Allow-Origin' in response['headers']
        assert 'Access-Control-Allow-Methods' in response['headers']


if __name__ == '__main__':
    pytest.main([__file__, '-v'])

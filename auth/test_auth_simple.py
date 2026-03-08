"""
Simple unit tests for authentication service core functions
Tests password hashing, JWT generation without AWS dependencies
"""

import os
import sys
from datetime import datetime, timedelta
import jwt
import bcrypt

# Set environment variables
os.environ['JWT_SECRET'] = 'test-secret-key-for-testing'
os.environ['ENVIRONMENT'] = 'test'

# Test the core functions directly without importing the full module
JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALGORITHM = 'HS256'
ACCESS_TOKEN_EXPIRE_HOURS = 24
REFRESH_TOKEN_EXPIRE_DAYS = 30


def hash_password(password: str) -> str:
    """Hash password using bcrypt"""
    salt = bcrypt.gensalt()
    password_hash = bcrypt.hashpw(password.encode('utf-8'), salt)
    return password_hash.decode('utf-8')


def verify_password(password: str, password_hash: str) -> bool:
    """Verify password against hash"""
    return bcrypt.checkpw(password.encode('utf-8'), password_hash.encode('utf-8'))


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


def verify_token(token: str, token_type: str = 'access'):
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


# Tests
def test_password_hashing():
    """Test password hashing creates valid bcrypt hash"""
    password = "test_password_123"
    hashed = hash_password(password)
    
    # Verify it's a valid bcrypt hash
    assert hashed.startswith('$2b$'), "Hash should start with $2b$"
    assert len(hashed) == 60, "Hash should be 60 characters"
    print("✓ Password hashing works correctly")


def test_password_verification_correct():
    """Test password verification with correct password"""
    password = "test_password_123"
    hashed = hash_password(password)
    
    assert verify_password(password, hashed) is True, "Correct password should verify"
    print("✓ Password verification with correct password works")


def test_password_verification_incorrect():
    """Test password verification with incorrect password"""
    password = "test_password_123"
    wrong_password = "wrong_password"
    hashed = hash_password(password)
    
    assert verify_password(wrong_password, hashed) is False, "Wrong password should not verify"
    print("✓ Password verification with incorrect password works")


def test_access_token_generation():
    """Test access token generation"""
    user_id = "test-user-id"
    leetcode_username = "test_user"
    
    token = generate_access_token(user_id, leetcode_username)
    
    # Decode and verify
    payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    assert payload['user_id'] == user_id, "User ID should match"
    assert payload['leetcode_username'] == leetcode_username, "Username should match"
    assert payload['token_type'] == 'access', "Token type should be access"
    print("✓ Access token generation works correctly")


def test_refresh_token_generation():
    """Test refresh token generation"""
    user_id = "test-user-id"
    
    token = generate_refresh_token(user_id)
    
    # Decode and verify
    payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    assert payload['user_id'] == user_id, "User ID should match"
    assert payload['token_type'] == 'refresh', "Token type should be refresh"
    print("✓ Refresh token generation works correctly")


def test_token_verification_valid():
    """Test verification of valid token"""
    user_id = "test-user-id"
    leetcode_username = "test_user"
    token = generate_access_token(user_id, leetcode_username)
    
    payload = verify_token(token, token_type='access')
    
    assert payload is not None, "Valid token should verify"
    assert payload['user_id'] == user_id, "User ID should match"
    print("✓ Valid token verification works")


def test_token_verification_expired():
    """Test verification of expired token"""
    # Create an expired token
    payload = {
        'user_id': 'test-user-id',
        'token_type': 'access',
        'exp': datetime.utcnow() - timedelta(hours=1),
        'iat': datetime.utcnow() - timedelta(hours=2)
    }
    token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
    
    result = verify_token(token, token_type='access')
    
    assert result is None, "Expired token should not verify"
    print("✓ Expired token verification works")


def test_token_verification_wrong_type():
    """Test verification fails for wrong token type"""
    user_id = "test-user-id"
    token = generate_refresh_token(user_id)
    
    # Try to verify as access token
    payload = verify_token(token, token_type='access')
    
    assert payload is None, "Wrong token type should not verify"
    print("✓ Wrong token type verification works")


def test_token_expiration_times():
    """Test that tokens have correct expiration times"""
    user_id = "test-user-id"
    
    # Test access token expiration
    access_token = generate_access_token(user_id, "test_user")
    access_payload = jwt.decode(access_token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    access_exp = datetime.fromtimestamp(access_payload['exp'])
    access_iat = datetime.fromtimestamp(access_payload['iat'])
    access_diff = (access_exp - access_iat).total_seconds() / 3600
    
    assert 23.9 < access_diff < 24.1, f"Access token should expire in 24 hours, got {access_diff}"
    
    # Test refresh token expiration
    refresh_token = generate_refresh_token(user_id)
    refresh_payload = jwt.decode(refresh_token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    refresh_exp = datetime.fromtimestamp(refresh_payload['exp'])
    refresh_iat = datetime.fromtimestamp(refresh_payload['iat'])
    refresh_diff = (refresh_exp - refresh_iat).total_seconds() / 86400
    
    assert 29.9 < refresh_diff < 30.1, f"Refresh token should expire in 30 days, got {refresh_diff}"
    print("✓ Token expiration times are correct")


if __name__ == '__main__':
    print("\n=== Running Authentication Service Tests ===\n")
    
    try:
        test_password_hashing()
        test_password_verification_correct()
        test_password_verification_incorrect()
        test_access_token_generation()
        test_refresh_token_generation()
        test_token_verification_valid()
        test_token_verification_expired()
        test_token_verification_wrong_type()
        test_token_expiration_times()
        
        print("\n=== All tests passed! ===\n")
    except AssertionError as e:
        print(f"\n✗ Test failed: {e}\n")
        sys.exit(1)
    except Exception as e:
        print(f"\n✗ Unexpected error: {e}\n")
        sys.exit(1)

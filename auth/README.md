# Authentication Service

FastAPI-based authentication service for CodeFlow AI Platform. Handles user registration, login, and JWT token management.

## Features

- **User Registration**: Create new user accounts with LeetCode username
- **User Login**: Authenticate users and issue JWT tokens
- **Token Refresh**: Refresh expired access tokens using refresh tokens
- **Password Security**: Bcrypt password hashing with salt
- **JWT Tokens**: Secure token-based authentication
- **CORS Support**: Full CORS configuration for React frontend

## API Endpoints

### POST /auth/register

Register a new user account.

**Request:**
```json
{
  "leetcode_username": "john_doe",
  "email": "john@example.com",
  "password": "securepassword123",
  "language_preference": "en"
}
```

**Response (201 Created):**
```json
{
  "user_id": "uuid-here",
  "access_token": "jwt-access-token",
  "refresh_token": "jwt-refresh-token",
  "expires_in": 86400
}
```

**Validation:**
- `leetcode_username`: Required, 1-50 characters
- `email`: Required, valid email format
- `password`: Required, minimum 8 characters
- `language_preference`: Optional, "en" or "hi" (default: "en")

**Error Responses:**
- `400 Bad Request`: Invalid input data
- `409 Conflict`: User with LeetCode username already exists
- `500 Internal Server Error`: Server error

### POST /auth/login

Login with existing credentials.

**Request:**
```json
{
  "leetcode_username": "john_doe",
  "password": "securepassword123"
}
```

**Response (200 OK):**
```json
{
  "access_token": "jwt-access-token",
  "refresh_token": "jwt-refresh-token",
  "user": {
    "user_id": "uuid",
    "leetcode_username": "john_doe",
    "language_preference": "en"
  }
}
```

**Error Responses:**
- `400 Bad Request`: Missing required fields
- `401 Unauthorized`: Invalid credentials
- `500 Internal Server Error`: Server error

### POST /auth/refresh

Refresh an expired access token.

**Request:**
```json
{
  "refresh_token": "jwt-refresh-token"
}
```

**Response (200 OK):**
```json
{
  "access_token": "new-jwt-access-token",
  "expires_in": 86400
}
```

**Error Responses:**
- `400 Bad Request`: Missing refresh token
- `401 Unauthorized`: Invalid or expired refresh token
- `500 Internal Server Error`: Server error

## JWT Token Details

### Access Token
- **Expiration**: 24 hours
- **Purpose**: API authentication
- **Claims**:
  - `user_id`: User's unique identifier
  - `leetcode_username`: User's LeetCode username
  - `token_type`: "access"
  - `exp`: Expiration timestamp
  - `iat`: Issued at timestamp

### Refresh Token
- **Expiration**: 30 days
- **Purpose**: Refresh access tokens
- **Claims**:
  - `user_id`: User's unique identifier
  - `token_type`: "refresh"
  - `exp`: Expiration timestamp
  - `iat`: Issued at timestamp

## Security Features

1. **Password Hashing**: Bcrypt with automatic salt generation
2. **JWT Signing**: HS256 algorithm with secret key
3. **Token Validation**: Expiration and type checking
4. **CORS Protection**: Configured allowed origins and methods
5. **Input Validation**: Pydantic models for request validation

## Environment Variables

- `USERS_TABLE`: DynamoDB table name for users
- `JWT_SECRET`: Secret key for JWT signing (must be changed in production)
- `ENVIRONMENT`: Deployment environment (dev/staging/prod)

## DynamoDB Schema

The service interacts with the Users table:

```python
{
  "user_id": "uuid",  # Partition Key
  "leetcode_username": "string",  # GSI
  "email": "string",
  "password_hash": "bcrypt-hash",
  "language_preference": "en|hi",
  "created_at": "ISO-8601-timestamp",
  "last_login": "ISO-8601-timestamp",
  "profile_data": {
    "total_solved": 0,
    "easy_solved": 0,
    "medium_solved": 0,
    "hard_solved": 0,
    "topic_proficiency": {},
    "recent_submissions": [],
    "last_synced": null
  }
}
```

## Testing

Run the test suite:

```bash
python3 lambda-functions/auth/test_auth_simple.py
```

Tests cover:
- Password hashing and verification
- JWT token generation (access and refresh)
- Token validation and expiration
- Token type verification

## Dependencies

Core dependencies (from shared Lambda layer):
- `boto3`: AWS SDK for DynamoDB
- `pydantic`: Request validation
- `PyJWT`: JWT token handling
- `cryptography`: JWT cryptographic operations
- `aws-xray-sdk`: Distributed tracing

Additional dependencies:
- `bcrypt`: Password hashing

## Deployment

This Lambda function is deployed via AWS CDK:

1. **Memory**: 512 MB
2. **Timeout**: 10 seconds
3. **Runtime**: Python 3.11
4. **Layers**: Shared dependencies layer
5. **IAM Permissions**:
   - DynamoDB: Read/Write on Users table
   - X-Ray: Tracing

## Usage Example

```python
import httpx

# Register
response = httpx.post(
    "https://api.codeflow.ai/auth/register",
    json={
        "leetcode_username": "john_doe",
        "email": "john@example.com",
        "password": "securepassword123"
    }
)
tokens = response.json()

# Login
response = httpx.post(
    "https://api.codeflow.ai/auth/login",
    json={
        "leetcode_username": "john_doe",
        "password": "securepassword123"
    }
)
tokens = response.json()

# Use access token for API calls
headers = {"Authorization": f"Bearer {tokens['access_token']}"}

# Refresh token when expired
response = httpx.post(
    "https://api.codeflow.ai/auth/refresh",
    json={"refresh_token": tokens['refresh_token']}
)
new_tokens = response.json()
```

## Security Considerations

1. **JWT Secret**: Change `JWT_SECRET` environment variable in production
2. **HTTPS Only**: Always use HTTPS in production
3. **Token Storage**: Store tokens securely (HttpOnly cookies or secure storage)
4. **Rate Limiting**: API Gateway handles rate limiting
5. **Password Policy**: Enforce minimum 8 characters (consider adding complexity requirements)

## Future Enhancements

- [ ] Email verification on registration
- [ ] Password reset functionality
- [ ] Multi-factor authentication (MFA)
- [ ] OAuth integration (GitHub, Google)
- [ ] Account lockout after failed attempts
- [ ] Password complexity requirements
- [ ] Token revocation/blacklist

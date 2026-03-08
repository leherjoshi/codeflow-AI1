# Authentication Service Integration Guide

## API Gateway Integration

The authentication service is designed to work with AWS API Gateway as a Lambda proxy integration.

### API Gateway Configuration

#### Routes

```
POST /auth/register  → Lambda: codeflow-auth-{env}
POST /auth/login     → Lambda: codeflow-auth-{env}
POST /auth/refresh   → Lambda: codeflow-auth-{env}
OPTIONS /auth/*      → Lambda: codeflow-auth-{env} (CORS preflight)
```

#### Lambda Proxy Integration

The Lambda function expects API Gateway proxy integration format:

**Input Event:**
```json
{
  "httpMethod": "POST",
  "path": "/auth/register",
  "headers": {
    "Content-Type": "application/json",
    "Origin": "https://codeflow.ai"
  },
  "body": "{\"leetcode_username\":\"john_doe\",\"email\":\"john@example.com\",\"password\":\"pass123\"}"
}
```

**Output Response:**
```json
{
  "statusCode": 201,
  "headers": {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Request-ID",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS"
  },
  "body": "{\"user_id\":\"...\",\"access_token\":\"...\",\"refresh_token\":\"...\"}"
}
```

### CORS Configuration

The service includes CORS headers in all responses:

- **Access-Control-Allow-Origin**: `*` (configure to specific domain in production)
- **Access-Control-Allow-Headers**: `Content-Type,Authorization,X-Request-ID`
- **Access-Control-Allow-Methods**: `GET,POST,PUT,DELETE,OPTIONS`

OPTIONS requests are handled automatically for CORS preflight.

## DynamoDB Integration

### Users Table Configuration

**Table Name**: `codeflow-users-{environment}`

**Primary Key**:
- Partition Key: `user_id` (String)

**Global Secondary Index**:
- Index Name: `leetcode-username-index`
- Partition Key: `leetcode_username` (String)
- Projection: ALL

**Attributes**:
```
user_id: String (PK)
leetcode_username: String (GSI)
email: String
password_hash: String
language_preference: String
created_at: String (ISO-8601)
last_login: String (ISO-8601)
profile_data: Map
```

### IAM Permissions

The Lambda execution role needs:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:Query"
      ],
      "Resource": [
        "arn:aws:dynamodb:*:*:table/codeflow-users-*",
        "arn:aws:dynamodb:*:*:table/codeflow-users-*/index/leetcode-username-index"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "xray:PutTraceSegments",
        "xray:PutTelemetryRecords"
      ],
      "Resource": "*"
    }
  ]
}
```

## Frontend Integration

### React Example

```typescript
// auth.service.ts
import axios from 'axios';

const API_BASE_URL = process.env.VITE_API_BASE_URL;

interface RegisterRequest {
  leetcode_username: string;
  email: string;
  password: string;
  language_preference?: 'en' | 'hi';
}

interface LoginRequest {
  leetcode_username: string;
  password: string;
}

interface AuthResponse {
  user_id?: string;
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  user?: {
    user_id: string;
    leetcode_username: string;
    language_preference: string;
  };
}

export const authService = {
  async register(data: RegisterRequest): Promise<AuthResponse> {
    const response = await axios.post(`${API_BASE_URL}/auth/register`, data);
    return response.data;
  },

  async login(data: LoginRequest): Promise<AuthResponse> {
    const response = await axios.post(`${API_BASE_URL}/auth/login`, data);
    return response.data;
  },

  async refresh(refreshToken: string): Promise<AuthResponse> {
    const response = await axios.post(`${API_BASE_URL}/auth/refresh`, {
      refresh_token: refreshToken
    });
    return response.data;
  },

  // Store tokens in localStorage
  setTokens(accessToken: string, refreshToken: string) {
    localStorage.setItem('access_token', accessToken);
    localStorage.setItem('refresh_token', refreshToken);
  },

  // Get access token
  getAccessToken(): string | null {
    return localStorage.getItem('access_token');
  },

  // Get refresh token
  getRefreshToken(): string | null {
    return localStorage.setItem('refresh_token');
  },

  // Clear tokens (logout)
  clearTokens() {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
  }
};
```

### Axios Interceptor for Token Refresh

```typescript
// axios.config.ts
import axios from 'axios';
import { authService } from './auth.service';

const api = axios.create({
  baseURL: process.env.VITE_API_BASE_URL
});

// Request interceptor to add access token
api.interceptors.request.use(
  (config) => {
    const token = authService.getAccessToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor to handle token refresh
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // If 401 and not already retried
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        const refreshToken = authService.getRefreshToken();
        if (!refreshToken) {
          throw new Error('No refresh token');
        }

        // Refresh the token
        const { access_token } = await authService.refresh(refreshToken);
        authService.setTokens(access_token, refreshToken);

        // Retry original request with new token
        originalRequest.headers.Authorization = `Bearer ${access_token}`;
        return api(originalRequest);
      } catch (refreshError) {
        // Refresh failed, logout user
        authService.clearTokens();
        window.location.href = '/login';
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

export default api;
```

## Testing Integration

### Manual Testing with curl

**Register:**
```bash
curl -X POST https://api.codeflow.ai/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "leetcode_username": "test_user",
    "email": "test@example.com",
    "password": "password123",
    "language_preference": "en"
  }'
```

**Login:**
```bash
curl -X POST https://api.codeflow.ai/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "leetcode_username": "test_user",
    "password": "password123"
  }'
```

**Refresh:**
```bash
curl -X POST https://api.codeflow.ai/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{
    "refresh_token": "your-refresh-token-here"
  }'
```

**Use Access Token:**
```bash
curl -X GET https://api.codeflow.ai/profile \
  -H "Authorization: Bearer your-access-token-here"
```

## Lambda Authorizer Integration

For protected endpoints, create a Lambda authorizer that validates JWT tokens:

```python
# lambda-authorizer.py
import os
import jwt
from typing import Dict, Any

JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALGORITHM = 'HS256'

def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Lambda authorizer for API Gateway
    Validates JWT access tokens
    """
    token = event['authorizationToken'].replace('Bearer ', '')
    
    try:
        # Verify token
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        
        # Check token type
        if payload.get('token_type') != 'access':
            raise Exception('Invalid token type')
        
        # Generate IAM policy
        return generate_policy(
            payload['user_id'],
            'Allow',
            event['methodArn'],
            payload
        )
    
    except Exception as e:
        print(f"Authorization failed: {str(e)}")
        return generate_policy('user', 'Deny', event['methodArn'])


def generate_policy(principal_id: str, effect: str, resource: str, context: Dict = None):
    """Generate IAM policy for API Gateway"""
    policy = {
        'principalId': principal_id,
        'policyDocument': {
            'Version': '2012-10-17',
            'Statement': [{
                'Action': 'execute-api:Invoke',
                'Effect': effect,
                'Resource': resource
            }]
        }
    }
    
    if context:
        policy['context'] = {
            'user_id': context.get('user_id'),
            'leetcode_username': context.get('leetcode_username')
        }
    
    return policy
```

## Monitoring and Logging

### CloudWatch Logs

The Lambda function logs to:
```
/aws/lambda/codeflow-auth-{environment}
```

**Log Events:**
- Registration attempts
- Login attempts
- Token refresh requests
- Authentication failures
- DynamoDB errors

### X-Ray Tracing

The function is instrumented with AWS X-Ray:
- Traces DynamoDB queries
- Tracks JWT generation time
- Monitors bcrypt hashing performance

### Metrics to Monitor

1. **Invocation Count**: Total requests
2. **Error Rate**: Failed authentications
3. **Duration**: Response time (target: <500ms)
4. **Concurrent Executions**: Lambda scaling
5. **DynamoDB Throttles**: Capacity issues

## Security Best Practices

1. **JWT Secret**: Use AWS Secrets Manager in production
2. **HTTPS Only**: Enforce TLS 1.3
3. **Rate Limiting**: Configure API Gateway throttling
4. **Input Validation**: Pydantic models validate all inputs
5. **Password Policy**: Minimum 8 characters (consider complexity)
6. **Token Rotation**: Implement token revocation for security events
7. **CORS**: Restrict origins in production

## Troubleshooting

### Common Issues

**Issue**: "User already exists" on registration
- **Cause**: LeetCode username is already registered
- **Solution**: Use a different username or login instead

**Issue**: "Invalid credentials" on login
- **Cause**: Wrong password or user doesn't exist
- **Solution**: Verify credentials or register

**Issue**: "Invalid or expired refresh token"
- **Cause**: Refresh token expired (30 days) or invalid
- **Solution**: Login again to get new tokens

**Issue**: DynamoDB throttling
- **Cause**: Too many requests
- **Solution**: Enable auto-scaling or use on-demand billing

**Issue**: Lambda timeout
- **Cause**: DynamoDB latency or bcrypt hashing
- **Solution**: Increase timeout or optimize queries

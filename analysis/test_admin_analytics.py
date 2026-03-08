"""
Unit tests for admin analytics service
"""

import json
import os
from datetime import datetime, timezone, timedelta
from unittest.mock import patch, MagicMock
import pytest

# Set environment variables before importing index
os.environ['USERS_TABLE'] = 'test-users-table'
os.environ['PROGRESS_TABLE'] = 'test-progress-table'
os.environ['ANALYTICS_TABLE'] = 'test-analytics-table'
os.environ['EVENT_BUS_NAME'] = 'test-event-bus'
os.environ['AWS_DEFAULT_REGION'] = 'us-east-1'
os.environ['ADMIN_API_KEY'] = 'test-admin-key-12345'

import index


@pytest.fixture
def mock_tables():
    """Mock DynamoDB tables"""
    with patch('index.users_table') as mock_users, \
         patch('index.progress_table') as mock_progress, \
         patch('index.analytics_table') as mock_analytics:
        
        yield {
            'users': mock_users,
            'progress': mock_progress,
            'analytics': mock_analytics
        }


def test_check_admin_auth_valid():
    """Test admin authentication with valid API key"""
    headers = {'X-Api-Key': 'test-admin-key-12345'}
    assert index.check_admin_auth(headers) is True


def test_check_admin_auth_invalid():
    """Test admin authentication with invalid API key"""
    headers = {'X-Api-Key': 'wrong-key'}
    assert index.check_admin_auth(headers) is False


def test_check_admin_auth_missing():
    """Test admin authentication with missing API key"""
    headers = {}
    assert index.check_admin_auth(headers) is False


def test_check_admin_auth_case_insensitive():
    """Test admin authentication header is case-insensitive"""
    headers = {'x-api-key': 'test-admin-key-12345'}
    assert index.check_admin_auth(headers) is True


def test_handle_admin_dau_unauthorized(mock_tables):
    """Test DAU endpoint rejects unauthorized requests"""
    headers = {'X-Api-Key': 'wrong-key'}
    
    response = index.handle_admin_dau(headers)
    
    assert response['statusCode'] == 403
    body = json.loads(response['body'])
    assert 'Forbidden' in body['error']


def test_handle_admin_dau_success(mock_tables):
    """Test DAU endpoint returns metrics successfully"""
    headers = {'X-Api-Key': 'test-admin-key-12345'}
    today = datetime.now(timezone.utc).date().isoformat()
    
    # Mock Analytics table responses
    mock_tables['analytics'].get_item.side_effect = [
        {'Item': {'date': today, 'metric_type': 'DAU', 'value': 150}},
        {'Item': {'date': today, 'metric_type': 'WAU', 'value': 800}},
        {'Item': {'date': today, 'metric_type': 'MAU', 'value': 2500}},
        {'Item': {
            'date': today,
            'metric_type': 'API_RESPONSE_TIME',
            'metadata': {'avg_ms': 120, 'p95_ms': 350, 'p99_ms': 800}
        }},
        {'Item': {
            'date': today,
            'metric_type': 'API_ERROR_RATE',
            'value': 2.5,
            'metadata': {'total_requests': 10000, 'error_count': 250}
        }}
    ]
    
    response = index.handle_admin_dau(headers)
    
    assert response['statusCode'] == 200
    body = json.loads(response['body'])
    assert body['dau'] == 150
    assert body['wau'] == 800
    assert body['mau'] == 2500
    assert body['api_metrics']['response_time']['avg_ms'] == 120
    assert body['api_metrics']['error_rate']['percentage'] == 2.5


def test_handle_admin_dau_fallback_calculation(mock_tables):
    """Test DAU endpoint falls back to calculating from Progress table"""
    headers = {'X-Api-Key': 'test-admin-key-12345'}
    today = datetime.now(timezone.utc).date().isoformat()
    week_ago = (datetime.now(timezone.utc) - timedelta(days=7)).date().isoformat()
    
    # Mock Analytics table returns no data
    mock_tables['analytics'].get_item.side_effect = [
        {},  # DAU not found
        {},  # WAU not found
        {},  # MAU not found
        {},  # API response time not found
        {}   # API error rate not found
    ]
    
    # Mock Progress table scan
    mock_tables['progress'].scan.return_value = {
        'Items': [
            {'user_id': 'user1', 'progress_id': f'user1#{today}'},
            {'user_id': 'user2', 'progress_id': f'user2#{today}'},
            {'user_id': 'user3', 'progress_id': f'user3#{week_ago}'},
        ]
    }
    
    response = index.handle_admin_dau(headers)
    
    assert response['statusCode'] == 200
    body = json.loads(response['body'])
    assert body['dau'] == 2  # user1 and user2 active today
    assert body['wau'] >= 2  # At least user1 and user2


def test_handle_admin_retention_unauthorized(mock_tables):
    """Test retention endpoint rejects unauthorized requests"""
    headers = {'X-Api-Key': 'wrong-key'}
    
    response = index.handle_admin_retention(headers)
    
    assert response['statusCode'] == 403
    body = json.loads(response['body'])
    assert 'Forbidden' in body['error']


def test_handle_admin_retention_success(mock_tables):
    """Test retention endpoint returns metrics successfully"""
    headers = {'X-Api-Key': 'test-admin-key-12345'}
    today = datetime.now(timezone.utc).date().isoformat()
    
    # Mock Analytics table responses
    mock_tables['analytics'].get_item.side_effect = [
        {'Item': {'date': today, 'metric_type': 'RETENTION_1D', 'value': 45.5}},
        {'Item': {'date': today, 'metric_type': 'RETENTION_7D', 'value': 32.8}},
        {'Item': {'date': today, 'metric_type': 'RETENTION_30D', 'value': 18.2}}
    ]
    
    response = index.handle_admin_retention(headers)
    
    assert response['statusCode'] == 200
    body = json.loads(response['body'])
    assert body['retention_1d'] == 45.5
    assert body['retention_7d'] == 32.8
    assert body['retention_30d'] == 18.2


def test_calculate_active_users_from_progress():
    """Test calculating DAU/WAU/MAU from Progress table"""
    today = datetime.now(timezone.utc).date().isoformat()
    week_ago = (datetime.now(timezone.utc) - timedelta(days=7)).date().isoformat()
    month_ago = (datetime.now(timezone.utc) - timedelta(days=30)).date().isoformat()
    
    with patch('index.progress_table') as mock_progress:
        mock_progress.scan.return_value = {
            'Items': [
                {'user_id': 'user1', 'progress_id': f'user1#{today}'},
                {'user_id': 'user2', 'progress_id': f'user2#{today}'},
                {'user_id': 'user3', 'progress_id': f'user3#{week_ago}'},
                {'user_id': 'user4', 'progress_id': f'user4#{month_ago}'},
                {'user_id': 'user1', 'progress_id': f'user1#{week_ago}'},  # Duplicate user
            ]
        }
        
        result = index.calculate_active_users_from_progress(today, week_ago, month_ago)
        
        assert result['dau'] == 2  # user1, user2
        assert result['wau'] >= 3  # user1, user2, user3
        assert result['mau'] >= 4  # user1, user2, user3, user4


def test_calculate_retention_from_progress():
    """Test calculating retention metrics from Progress table"""
    today = datetime.now(timezone.utc).date().isoformat()
    
    with patch('index.progress_table') as mock_progress:
        yesterday = (datetime.now(timezone.utc) - timedelta(days=1)).date().isoformat()
        
        mock_progress.scan.return_value = {
            'Items': [
                # 2 users from yesterday cohort
                {'user_id': 'user1', 'progress_id': f'user1#{yesterday}'},
                {'user_id': 'user2', 'progress_id': f'user2#{yesterday}'},
                # 1 user returned today
                {'user_id': 'user1', 'progress_id': f'user1#{today}'},
            ]
        }
        
        result = index.calculate_retention_from_progress(today)
        
        # 1 out of 2 users returned = 50% retention
        assert result['retention_1d'] == 50.0


def test_get_api_metrics_success():
    """Test fetching API metrics from Analytics table"""
    today = datetime.now(timezone.utc).date().isoformat()
    
    with patch('index.analytics_table') as mock_analytics:
        mock_analytics.get_item.side_effect = [
            {'Item': {
                'date': today,
                'metric_type': 'API_RESPONSE_TIME',
                'metadata': {'avg_ms': 150, 'p95_ms': 400, 'p99_ms': 900}
            }},
            {'Item': {
                'date': today,
                'metric_type': 'API_ERROR_RATE',
                'value': 3.2,
                'metadata': {'total_requests': 5000, 'error_count': 160}
            }}
        ]
        
        result = index.get_api_metrics(today)
        
        assert result['response_time']['avg_ms'] == 150
        assert result['response_time']['p95_ms'] == 400
        assert result['response_time']['p99_ms'] == 900
        assert result['error_rate']['percentage'] == 3.2
        assert result['error_rate']['total_requests'] == 5000
        assert result['error_rate']['error_count'] == 160


def test_get_api_metrics_no_data():
    """Test fetching API metrics when no data exists"""
    today = datetime.now(timezone.utc).date().isoformat()
    
    with patch('index.analytics_table') as mock_analytics:
        mock_analytics.get_item.side_effect = [{}, {}]  # No data
        
        result = index.get_api_metrics(today)
        
        assert result['response_time']['avg_ms'] == 0
        assert result['error_rate']['percentage'] == 0


def test_handler_admin_dau_route(mock_tables):
    """Test handler routes to admin DAU endpoint"""
    event = {
        'httpMethod': 'GET',
        'path': '/admin/analytics/dau',
        'headers': {'X-Api-Key': 'test-admin-key-12345'},
        'body': None
    }
    
    today = datetime.now(timezone.utc).date().isoformat()
    mock_tables['analytics'].get_item.side_effect = [
        {'Item': {'date': today, 'metric_type': 'DAU', 'value': 100}},
        {'Item': {'date': today, 'metric_type': 'WAU', 'value': 500}},
        {'Item': {'date': today, 'metric_type': 'MAU', 'value': 1500}},
        {},  # API response time
        {}   # API error rate
    ]
    
    response = index.handler(event, None)
    
    assert response['statusCode'] == 200
    body = json.loads(response['body'])
    assert 'dau' in body
    assert 'wau' in body
    assert 'mau' in body


def test_handler_admin_retention_route(mock_tables):
    """Test handler routes to admin retention endpoint"""
    event = {
        'httpMethod': 'GET',
        'path': '/admin/analytics/retention',
        'headers': {'X-Api-Key': 'test-admin-key-12345'},
        'body': None
    }
    
    today = datetime.now(timezone.utc).date().isoformat()
    mock_tables['analytics'].get_item.side_effect = [
        {'Item': {'date': today, 'metric_type': 'RETENTION_1D', 'value': 40.0}},
        {'Item': {'date': today, 'metric_type': 'RETENTION_7D', 'value': 30.0}},
        {'Item': {'date': today, 'metric_type': 'RETENTION_30D', 'value': 20.0}}
    ]
    
    response = index.handler(event, None)
    
    assert response['statusCode'] == 200
    body = json.loads(response['body'])
    assert 'retention_1d' in body
    assert 'retention_7d' in body
    assert 'retention_30d' in body

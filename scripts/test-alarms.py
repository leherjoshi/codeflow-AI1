#!/usr/bin/env python3
"""
Test CloudWatch alarms by publishing test metrics.

This script publishes test metrics to trigger CloudWatch alarms
to verify they are configured correctly.

Usage:
    python test-alarms.py --alarm billing --region us-east-1
    python test-alarms.py --alarm api-error --environment prod
    python test-alarms.py --alarm bedrock-latency --environment prod
"""

import boto3
import sys
import time
from datetime import datetime

def test_billing_alarm(cloudwatch, threshold: float = 40.0):
    """Test billing alarm by publishing a test metric."""
    print(f"🧪 Testing billing alarm (threshold: ${threshold})...")
    print("   Note: This publishes a test metric to AWS/Billing namespace")
    print("   The alarm should trigger if the test value exceeds the threshold")
    
    try:
        # Publish a test metric slightly above threshold
        test_value = threshold + 1.0
        
        cloudwatch.put_metric_data(
            Namespace='AWS/Billing',
            MetricData=[
                {
                    'MetricName': 'EstimatedCharges',
                    'Value': test_value,
                    'Unit': 'None',
                    'Timestamp': datetime.utcnow(),
                    'Dimensions': [
                        {
                            'Name': 'Currency',
                            'Value': 'USD'
                        }
                    ]
                }
            ]
        )
        
        print(f"✅ Published test metric: EstimatedCharges = ${test_value}")
        print("   Wait 5-10 minutes for alarm to evaluate")
        print("   Check alarm state: aws cloudwatch describe-alarms --alarm-names budget-50-percent")
        return True
    except Exception as e:
        print(f"❌ Error publishing test metric: {str(e)}")
        return False

def test_api_error_alarm(cloudwatch, environment: str):
    """Test API error rate alarm by publishing test metrics."""
    print(f"🧪 Testing API error rate alarm for environment: {environment}...")
    
    try:
        # Publish test error metrics
        for i in range(15):  # Publish 15 errors to exceed 5% threshold
            cloudwatch.put_metric_data(
                Namespace='AWS/ApiGateway',
                MetricData=[
                    {
                        'MetricName': '5XXError',
                        'Value': 1,
                        'Unit': 'Count',
                        'Timestamp': datetime.utcnow()
                    }
                ]
            )
            time.sleep(0.1)
        
        print(f"✅ Published 15 test error metrics")
        print("   Wait 5-10 minutes for alarm to evaluate")
        print(f"   Check alarm state: aws cloudwatch describe-alarms --alarm-names CodeFlow-API-ErrorRate-{environment}")
        return True
    except Exception as e:
        print(f"❌ Error publishing test metrics: {str(e)}")
        return False

def test_bedrock_latency_alarm(cloudwatch, environment: str):
    """Test Bedrock latency alarm by publishing test metrics."""
    print(f"🧪 Testing Bedrock latency alarm for environment: {environment}...")
    
    try:
        # Publish test latency metrics above threshold (10 seconds = 10000ms)
        for i in range(5):
            cloudwatch.put_metric_data(
                Namespace='CodeFlow/GenAI',
                MetricData=[
                    {
                        'MetricName': 'BedrockLatency',
                        'Value': 12000,  # 12 seconds
                        'Unit': 'Milliseconds',
                        'Timestamp': datetime.utcnow()
                    }
                ]
            )
            time.sleep(0.1)
        
        print(f"✅ Published 5 test latency metrics (12000ms each)")
        print("   Wait 5-10 minutes for alarm to evaluate")
        print(f"   Check alarm state: aws cloudwatch describe-alarms --alarm-names CodeFlow-Bedrock-HighLatency-{environment}")
        return True
    except Exception as e:
        print(f"❌ Error publishing test metrics: {str(e)}")
        return False

def test_dynamodb_throttling_alarm(cloudwatch, environment: str):
    """Test DynamoDB throttling alarm by publishing test metrics."""
    print(f"🧪 Testing DynamoDB throttling alarm for environment: {environment}...")
    
    try:
        # Publish test throttling metrics
        for i in range(10):  # Publish 10 throttling events
            cloudwatch.put_metric_data(
                Namespace='AWS/DynamoDB',
                MetricData=[
                    {
                        'MetricName': 'UserErrors',
                        'Value': 1,
                        'Unit': 'Count',
                        'Timestamp': datetime.utcnow(),
                        'Dimensions': [
                            {
                                'Name': 'TableName',
                                'Value': 'Users'
                            }
                        ]
                    }
                ]
            )
            time.sleep(0.1)
        
        print(f"✅ Published 10 test throttling metrics")
        print("   Wait 5-10 minutes for alarm to evaluate")
        print(f"   Check alarm state: aws cloudwatch describe-alarms --alarm-names CodeFlow-DynamoDB-Throttling-{environment}")
        return True
    except Exception as e:
        print(f"❌ Error publishing test metrics: {str(e)}")
        return False

def test_cache_hit_rate_alarm(cloudwatch, environment: str):
    """Test LLM cache hit rate alarm by publishing test metrics."""
    print(f"🧪 Testing LLM cache hit rate alarm for environment: {environment}...")
    
    try:
        # Publish test cache hit rate below threshold (40%)
        cloudwatch.put_metric_data(
            Namespace='CodeFlow/GenAI',
            MetricData=[
                {
                    'MetricName': 'LLMCacheHitRate',
                    'Value': 30.0,  # 30% hit rate (below 40% threshold)
                    'Unit': 'Percent',
                    'Timestamp': datetime.utcnow()
                }
            ]
        )
        
        print(f"✅ Published test cache hit rate metric (30%)")
        print("   Wait 5-10 minutes for alarm to evaluate")
        print(f"   Check alarm state: aws cloudwatch describe-alarms --alarm-names CodeFlow-LLM-LowCacheHitRate-{environment}")
        return True
    except Exception as e:
        print(f"❌ Error publishing test metric: {str(e)}")
        return False

def reset_alarm_state(cloudwatch, alarm_name: str):
    """Reset alarm state to OK."""
    print(f"🔄 Resetting alarm state: {alarm_name}...")
    
    try:
        cloudwatch.set_alarm_state(
            AlarmName=alarm_name,
            StateValue='OK',
            StateReason='Manual reset after testing'
        )
        print(f"✅ Alarm state reset to OK")
        return True
    except Exception as e:
        print(f"❌ Error resetting alarm: {str(e)}")
        return False

def main():
    import argparse
    
    parser = argparse.ArgumentParser(description='Test CloudWatch alarms')
    parser.add_argument('--alarm', required=True, 
                       choices=['billing', 'api-error', 'bedrock-latency', 'dynamodb-throttling', 'cache-hit-rate', 'all'],
                       help='Alarm to test')
    parser.add_argument('--region', default='us-east-1', help='AWS region')
    parser.add_argument('--environment', default='prod', help='Environment (prod/dev)')
    parser.add_argument('--reset', action='store_true', help='Reset alarm state to OK after testing')
    args = parser.parse_args()
    
    print(f"🧪 Testing CloudWatch alarms")
    print(f"   Region: {args.region}")
    print(f"   Environment: {args.environment}\n")
    
    # Initialize AWS client
    cloudwatch = boto3.client('cloudwatch', region_name=args.region)
    
    success = True
    
    if args.alarm == 'billing' or args.alarm == 'all':
        print("=" * 60)
        success = test_billing_alarm(cloudwatch) and success
        print()
    
    if args.alarm == 'api-error' or args.alarm == 'all':
        print("=" * 60)
        success = test_api_error_alarm(cloudwatch, args.environment) and success
        print()
    
    if args.alarm == 'bedrock-latency' or args.alarm == 'all':
        print("=" * 60)
        success = test_bedrock_latency_alarm(cloudwatch, args.environment) and success
        print()
    
    if args.alarm == 'dynamodb-throttling' or args.alarm == 'all':
        print("=" * 60)
        success = test_dynamodb_throttling_alarm(cloudwatch, args.environment) and success
        print()
    
    if args.alarm == 'cache-hit-rate' or args.alarm == 'all':
        print("=" * 60)
        success = test_cache_hit_rate_alarm(cloudwatch, args.environment) and success
        print()
    
    if args.reset:
        print("=" * 60)
        print("Resetting alarm states...")
        print("=" * 60)
        alarms_to_reset = []
        
        if args.alarm == 'billing' or args.alarm == 'all':
            alarms_to_reset.extend(['budget-50-percent', 'budget-75-percent', 'budget-90-percent'])
        if args.alarm == 'api-error' or args.alarm == 'all':
            alarms_to_reset.append(f'CodeFlow-API-ErrorRate-{args.environment}')
        if args.alarm == 'bedrock-latency' or args.alarm == 'all':
            alarms_to_reset.append(f'CodeFlow-Bedrock-HighLatency-{args.environment}')
        if args.alarm == 'dynamodb-throttling' or args.alarm == 'all':
            alarms_to_reset.append(f'CodeFlow-DynamoDB-Throttling-{args.environment}')
        if args.alarm == 'cache-hit-rate' or args.alarm == 'all':
            alarms_to_reset.append(f'CodeFlow-LLM-LowCacheHitRate-{args.environment}')
        
        for alarm in alarms_to_reset:
            reset_alarm_state(cloudwatch, alarm)
            print()
    
    print("=" * 60)
    print("SUMMARY")
    print("=" * 60)
    
    if success:
        print("✅ Test metrics published successfully")
        print("\n📝 Next steps:")
        print("   1. Wait 5-10 minutes for alarms to evaluate")
        print("   2. Check alarm states in CloudWatch console")
        print("   3. Verify SNS notifications are received")
        print("   4. Reset alarm states with --reset flag")
        return 0
    else:
        print("❌ Some tests failed")
        return 1

if __name__ == "__main__":
    sys.exit(main())

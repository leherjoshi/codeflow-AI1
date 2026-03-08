#!/usr/bin/env python3
"""
Verify CloudWatch monitoring setup for CodeFlow AI Platform.

This script checks that all required CloudWatch dashboards and alarms
are properly configured and accessible.

Usage:
    python verify-monitoring.py [--region us-east-1] [--environment prod]
"""

import boto3
import sys
from typing import List, Dict, Tuple

def check_dashboards(cloudwatch, environment: str) -> Tuple[bool, List[str]]:
    """Check if required CloudWatch dashboards exist."""
    required_dashboards = [
        f"CodeFlow-GenAI-Performance-{environment}",
        f"CodeFlow-API-Health-{environment}",
        f"CodeFlow-User-Engagement-{environment}"
    ]
    
    issues = []
    
    try:
        response = cloudwatch.list_dashboards()
        existing_dashboards = [d['DashboardName'] for d in response.get('DashboardEntries', [])]
        
        for dashboard in required_dashboards:
            if dashboard in existing_dashboards:
                print(f"✅ Dashboard found: {dashboard}")
            else:
                issues.append(f"❌ Dashboard missing: {dashboard}")
                print(issues[-1])
        
        return len(issues) == 0, issues
    except Exception as e:
        issues.append(f"❌ Error checking dashboards: {str(e)}")
        print(issues[-1])
        return False, issues

def check_alarms(cloudwatch, environment: str) -> Tuple[bool, List[str]]:
    """Check if required CloudWatch alarms exist and are enabled."""
    required_alarms = [
        f"CodeFlow-API-ErrorRate-{environment}",
        f"CodeFlow-Bedrock-HighLatency-{environment}",
        f"CodeFlow-DynamoDB-Throttling-{environment}",
        f"CodeFlow-Lambda-HighConcurrency-{environment}",
        f"CodeFlow-LLM-LowCacheHitRate-{environment}"
    ]
    
    issues = []
    
    try:
        response = cloudwatch.describe_alarms()
        existing_alarms = {a['AlarmName']: a for a in response.get('MetricAlarms', [])}
        
        for alarm_name in required_alarms:
            if alarm_name in existing_alarms:
                alarm = existing_alarms[alarm_name]
                state = alarm.get('StateValue', 'UNKNOWN')
                actions_enabled = alarm.get('ActionsEnabled', False)
                
                if actions_enabled:
                    print(f"✅ Alarm configured: {alarm_name} (State: {state})")
                else:
                    issues.append(f"⚠️  Alarm exists but actions disabled: {alarm_name}")
                    print(issues[-1])
            else:
                issues.append(f"❌ Alarm missing: {alarm_name}")
                print(issues[-1])
        
        return len(issues) == 0, issues
    except Exception as e:
        issues.append(f"❌ Error checking alarms: {str(e)}")
        print(issues[-1])
        return False, issues

def check_sns_topic(sns, environment: str) -> Tuple[bool, List[str]]:
    """Check if SNS topic for alarms exists and has subscriptions."""
    topic_name = f"codeflow-alarms-{environment}"
    issues = []
    
    try:
        response = sns.list_topics()
        topics = response.get('Topics', [])
        
        topic_arn = None
        for topic in topics:
            if topic_name in topic['TopicArn']:
                topic_arn = topic['TopicArn']
                print(f"✅ SNS topic found: {topic_arn}")
                break
        
        if not topic_arn:
            issues.append(f"❌ SNS topic missing: {topic_name}")
            print(issues[-1])
            return False, issues
        
        # Check subscriptions
        subs_response = sns.list_subscriptions_by_topic(TopicArn=topic_arn)
        subscriptions = subs_response.get('Subscriptions', [])
        
        if len(subscriptions) == 0:
            issues.append(f"⚠️  SNS topic has no subscriptions: {topic_name}")
            print(issues[-1])
            print("   Add subscriptions with:")
            print(f"   aws sns subscribe --topic-arn {topic_arn} --protocol email --notification-endpoint your-email@example.com")
        else:
            print(f"✅ SNS topic has {len(subscriptions)} subscription(s)")
            for sub in subscriptions:
                protocol = sub.get('Protocol', 'unknown')
                endpoint = sub.get('Endpoint', 'unknown')
                status = sub.get('SubscriptionArn', 'PendingConfirmation')
                if status == 'PendingConfirmation':
                    print(f"   ⚠️  {protocol}: {endpoint} (Pending Confirmation)")
                else:
                    print(f"   ✅ {protocol}: {endpoint}")
        
        return len([i for i in issues if i.startswith('❌')]) == 0, issues
    except Exception as e:
        issues.append(f"❌ Error checking SNS topic: {str(e)}")
        print(issues[-1])
        return False, issues

def check_billing_alarms(cloudwatch) -> Tuple[bool, List[str]]:
    """Check if billing alarms are configured (critical for budget mode)."""
    required_billing_alarms = [
        "budget-50-percent",
        "budget-75-percent",
        "budget-90-percent"
    ]
    
    issues = []
    
    try:
        response = cloudwatch.describe_alarms()
        existing_alarms = {a['AlarmName']: a for a in response.get('MetricAlarms', [])}
        
        for alarm_name in required_billing_alarms:
            if alarm_name in existing_alarms:
                alarm = existing_alarms[alarm_name]
                threshold = alarm.get('Threshold', 0)
                print(f"✅ Billing alarm configured: {alarm_name} (Threshold: ${threshold})")
            else:
                issues.append(f"❌ CRITICAL: Billing alarm missing: {alarm_name}")
                print(issues[-1])
        
        if len(issues) > 0:
            print("\n⚠️  BUDGET MODE REQUIRES BILLING ALARMS!")
            print("   Run the commands in ULTRA-BUDGET-MODE.md to create them.")
        
        return len(issues) == 0, issues
    except Exception as e:
        issues.append(f"❌ Error checking billing alarms: {str(e)}")
        print(issues[-1])
        return False, issues

def get_dashboard_urls(region: str, environment: str) -> None:
    """Print direct URLs to CloudWatch dashboards."""
    print("\n📊 Dashboard URLs:")
    print(f"   GenAI Performance: https://{region}.console.aws.amazon.com/cloudwatch/home?region={region}#dashboards:name=CodeFlow-GenAI-Performance-{environment}")
    print(f"   API Health: https://{region}.console.aws.amazon.com/cloudwatch/home?region={region}#dashboards:name=CodeFlow-API-Health-{environment}")
    print(f"   User Engagement: https://{region}.console.aws.amazon.com/cloudwatch/home?region={region}#dashboards:name=CodeFlow-User-Engagement-{environment}")
    print(f"\n🚨 Alarms: https://{region}.console.aws.amazon.com/cloudwatch/home?region={region}#alarmsV2:")

def main():
    import argparse
    
    parser = argparse.ArgumentParser(description='Verify CloudWatch monitoring setup')
    parser.add_argument('--region', default='us-east-1', help='AWS region')
    parser.add_argument('--environment', default='prod', help='Environment (prod/dev)')
    args = parser.parse_args()
    
    print(f"🔍 Verifying CloudWatch monitoring for environment: {args.environment}")
    print(f"   Region: {args.region}\n")
    
    # Initialize AWS clients
    cloudwatch = boto3.client('cloudwatch', region_name=args.region)
    sns = boto3.client('sns', region_name=args.region)
    
    all_passed = True
    all_issues = []
    
    # Check dashboards
    print("=" * 60)
    print("Checking CloudWatch Dashboards...")
    print("=" * 60)
    passed, issues = check_dashboards(cloudwatch, args.environment)
    all_passed = all_passed and passed
    all_issues.extend(issues)
    
    # Check alarms
    print("\n" + "=" * 60)
    print("Checking CloudWatch Alarms...")
    print("=" * 60)
    passed, issues = check_alarms(cloudwatch, args.environment)
    all_passed = all_passed and passed
    all_issues.extend(issues)
    
    # Check SNS topic
    print("\n" + "=" * 60)
    print("Checking SNS Topic...")
    print("=" * 60)
    passed, issues = check_sns_topic(sns, args.environment)
    all_passed = all_passed and passed
    all_issues.extend(issues)
    
    # Check billing alarms (CRITICAL for budget mode)
    print("\n" + "=" * 60)
    print("Checking Billing Alarms (CRITICAL)...")
    print("=" * 60)
    passed, issues = check_billing_alarms(cloudwatch)
    all_passed = all_passed and passed
    all_issues.extend(issues)
    
    # Print dashboard URLs
    get_dashboard_urls(args.region, args.environment)
    
    # Summary
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    
    if all_passed:
        print("✅ All monitoring checks passed!")
        print("\n📝 Next steps:")
        print("   1. Add email subscriptions to SNS topic")
        print("   2. Review dashboard metrics daily")
        print("   3. Test alarm notifications")
        return 0
    else:
        print(f"❌ {len([i for i in all_issues if i.startswith('❌')])} critical issue(s) found")
        print(f"⚠️  {len([i for i in all_issues if i.startswith('⚠️')])} warning(s)")
        print("\n📝 Issues to fix:")
        for issue in all_issues:
            print(f"   {issue}")
        return 1

if __name__ == "__main__":
    sys.exit(main())

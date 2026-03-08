# Monitoring Scripts

This directory contains scripts for verifying and testing CloudWatch monitoring setup for the CodeFlow AI Platform.

## Scripts Overview

### 1. verify-monitoring.py

Verifies that all required CloudWatch dashboards, alarms, and SNS topics are properly configured.

**Usage**:
```bash
python verify-monitoring.py [--region us-east-1] [--environment prod]
```

**What it checks**:
- ✅ CloudWatch dashboards exist (GenAI Performance, API Health, User Engagement)
- ✅ CloudWatch alarms are configured and enabled
- ✅ SNS topic exists and has subscriptions
- ✅ Billing alarms are configured (CRITICAL for budget mode)

**Example output**:
```
🔍 Verifying CloudWatch monitoring for environment: prod
   Region: us-east-1

============================================================
Checking CloudWatch Dashboards...
============================================================
✅ Dashboard found: CodeFlow-GenAI-Performance-prod
✅ Dashboard found: CodeFlow-API-Health-prod
✅ Dashboard found: CodeFlow-User-Engagement-prod

============================================================
Checking CloudWatch Alarms...
============================================================
✅ Alarm configured: CodeFlow-API-ErrorRate-prod (State: OK)
✅ Alarm configured: CodeFlow-Bedrock-HighLatency-prod (State: OK)
✅ Alarm configured: CodeFlow-DynamoDB-Throttling-prod (State: OK)
✅ Alarm configured: CodeFlow-Lambda-HighConcurrency-prod (State: OK)
✅ Alarm configured: CodeFlow-LLM-LowCacheHitRate-prod (State: OK)

============================================================
Checking SNS Topic...
============================================================
✅ SNS topic found: arn:aws:sns:us-east-1:123456789012:codeflow-alarms-prod
✅ SNS topic has 2 subscription(s)
   ✅ email: admin@example.com
   ⚠️  sms: +1234567890 (Pending Confirmation)

============================================================
Checking Billing Alarms (CRITICAL)...
============================================================
✅ Billing alarm configured: budget-50-percent (Threshold: $40)
✅ Billing alarm configured: budget-75-percent (Threshold: $60)
✅ Billing alarm configured: budget-90-percent (Threshold: $80)

📊 Dashboard URLs:
   GenAI Performance: https://us-east-1.console.aws.amazon.com/cloudwatch/home?region=us-east-1#dashboards:name=CodeFlow-GenAI-Performance-prod
   API Health: https://us-east-1.console.aws.amazon.com/cloudwatch/home?region=us-east-1#dashboards:name=CodeFlow-API-Health-prod
   User Engagement: https://us-east-1.console.aws.amazon.com/cloudwatch/home?region=us-east-1#dashboards:name=CodeFlow-User-Engagement-prod

🚨 Alarms: https://us-east-1.console.aws.amazon.com/cloudwatch/home?region=us-east-1#alarmsV2:

============================================================
SUMMARY
============================================================
✅ All monitoring checks passed!

📝 Next steps:
   1. Add email subscriptions to SNS topic
   2. Review dashboard metrics daily
   3. Test alarm notifications
```

### 2. test-alarms.py

Tests CloudWatch alarms by publishing test metrics to trigger them. Useful for verifying alarm configuration and notification delivery.

**Usage**:
```bash
# Test specific alarm
python test-alarms.py --alarm billing --region us-east-1
python test-alarms.py --alarm api-error --environment prod --region us-east-1
python test-alarms.py --alarm bedrock-latency --environment prod --region us-east-1

# Test all alarms
python test-alarms.py --alarm all --environment prod --region us-east-1

# Reset alarm states after testing
python test-alarms.py --alarm all --environment prod --region us-east-1 --reset
```

**Available alarm tests**:
- `billing` - Test billing alarms (budget-50-percent, budget-75-percent, budget-90-percent)
- `api-error` - Test API error rate alarm
- `bedrock-latency` - Test Bedrock latency alarm
- `dynamodb-throttling` - Test DynamoDB throttling alarm
- `cache-hit-rate` - Test LLM cache hit rate alarm
- `all` - Test all alarms

**Example output**:
```
🧪 Testing CloudWatch alarms
   Region: us-east-1
   Environment: prod

============================================================
🧪 Testing API error rate alarm for environment: prod...
✅ Published 15 test error metrics
   Wait 5-10 minutes for alarm to evaluate
   Check alarm state: aws cloudwatch describe-alarms --alarm-names CodeFlow-API-ErrorRate-prod

============================================================
SUMMARY
============================================================
✅ Test metrics published successfully

📝 Next steps:
   1. Wait 5-10 minutes for alarms to evaluate
   2. Check alarm states in CloudWatch console
   3. Verify SNS notifications are received
   4. Reset alarm states with --reset flag
```

**Important Notes**:
- Test metrics will trigger actual alarms and send notifications
- Wait 5-10 minutes for alarms to evaluate after publishing test metrics
- Use `--reset` flag to reset alarm states to OK after testing
- Billing alarm tests publish to AWS/Billing namespace (be careful!)

## Prerequisites

### Python Dependencies

Install required Python packages:
```bash
pip install boto3
```

### AWS Credentials

Ensure AWS credentials are configured:
```bash
# Option 1: AWS CLI configuration
aws configure

# Option 2: Environment variables
export AWS_ACCESS_KEY_ID=your_access_key
export AWS_SECRET_ACCESS_KEY=your_secret_key
export AWS_DEFAULT_REGION=us-east-1

# Option 3: IAM role (if running on EC2/Lambda)
# No configuration needed
```

### IAM Permissions

The scripts require the following IAM permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "cloudwatch:DescribeAlarms",
        "cloudwatch:ListDashboards",
        "cloudwatch:GetDashboard",
        "cloudwatch:PutMetricData",
        "cloudwatch:SetAlarmState",
        "sns:ListTopics",
        "sns:ListSubscriptionsByTopic"
      ],
      "Resource": "*"
    }
  ]
}
```

## Common Use Cases

### 1. Initial Setup Verification

After deploying the infrastructure, verify monitoring is configured:
```bash
python verify-monitoring.py --region us-east-1 --environment prod
```

### 2. Test Alarm Notifications

Test that alarms trigger and notifications are delivered:
```bash
# Test one alarm
python test-alarms.py --alarm api-error --environment prod --region us-east-1

# Wait 5-10 minutes, check email/Slack for notification

# Reset alarm state
python test-alarms.py --alarm api-error --environment prod --region us-east-1 --reset
```

### 3. Daily Monitoring Check

Add to cron for daily verification:
```bash
# Add to crontab
0 9 * * * cd /path/to/infrastructure/scripts && python verify-monitoring.py --region us-east-1 --environment prod
```

### 4. Pre-Deployment Validation

Before deploying changes, verify monitoring is healthy:
```bash
python verify-monitoring.py --region us-east-1 --environment prod
if [ $? -eq 0 ]; then
  echo "Monitoring healthy, proceeding with deployment"
  # Deploy changes
else
  echo "Monitoring issues detected, fix before deploying"
  exit 1
fi
```

## Troubleshooting

### Script Fails with "Access Denied"

**Issue**: Script exits with AWS access denied error

**Solution**:
1. Verify AWS credentials are configured: `aws sts get-caller-identity`
2. Check IAM permissions include required CloudWatch and SNS actions
3. Verify region is correct

### No Dashboards Found

**Issue**: Script reports dashboards are missing

**Solution**:
1. Verify dashboards were created during infrastructure deployment
2. Check correct region: `aws cloudwatch list-dashboards --region us-east-1`
3. Verify environment name matches (prod/dev)
4. Re-deploy infrastructure if dashboards are missing

### Alarms Not Triggering During Test

**Issue**: Test metrics published but alarms don't trigger

**Solution**:
1. Wait 5-10 minutes for alarm evaluation period
2. Check alarm configuration: `aws cloudwatch describe-alarms --alarm-names <name>`
3. Verify metric namespace and name match alarm configuration
4. Check alarm threshold and evaluation periods

### SNS Notifications Not Received

**Issue**: Alarms trigger but no notifications received

**Solution**:
1. Verify SNS subscription is confirmed (check email spam folder)
2. Check SNS topic has subscriptions: `aws sns list-subscriptions-by-topic --topic-arn <arn>`
3. Test SNS topic directly: `aws sns publish --topic-arn <arn> --message "Test"`
4. Check SNS topic permissions

## Integration with CI/CD

### GitHub Actions Example

```yaml
name: Verify Monitoring

on:
  schedule:
    - cron: '0 9 * * *'  # Daily at 9 AM
  workflow_dispatch:

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v1
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: us-east-1
      
      - name: Install dependencies
        run: pip install boto3
      
      - name: Verify monitoring
        run: |
          cd infrastructure/scripts
          python verify-monitoring.py --region us-east-1 --environment prod
```

### AWS Lambda Example

Deploy as a Lambda function for automated monitoring checks:

```python
import json
import subprocess

def lambda_handler(event, context):
    """Run monitoring verification as Lambda function."""
    result = subprocess.run(
        ['python', 'verify-monitoring.py', '--region', 'us-east-1', '--environment', 'prod'],
        capture_output=True,
        text=True
    )
    
    return {
        'statusCode': 200 if result.returncode == 0 else 500,
        'body': json.dumps({
            'stdout': result.stdout,
            'stderr': result.stderr,
            'returncode': result.returncode
        })
    }
```

## Best Practices

1. **Run verification after infrastructure changes**: Always verify monitoring after deploying infrastructure updates

2. **Test alarms periodically**: Test alarms monthly to ensure notifications work

3. **Monitor script execution**: Set up alerts if verification script fails

4. **Document issues**: Keep a log of monitoring issues and resolutions

5. **Automate checks**: Integrate verification into CI/CD pipeline

6. **Review thresholds**: Regularly review and adjust alarm thresholds based on actual usage

## References

- [CloudWatch Documentation](../docs/CLOUDWATCH.md)
- [Monitoring Access Guide](../docs/MONITORING-ACCESS.md)
- [On-Call Guide](../docs/ON-CALL-GUIDE.md)
- [Ultra Budget Mode](../../ULTRA-BUDGET-MODE.md)

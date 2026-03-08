# Knowledge Base Seeding - Quick Start

## TL;DR

```bash
# 1. Test locally (no AWS required)
cd lambda-functions/rag
python3 test_seeding.py

# 2. Seed DynamoDB (requires AWS credentials)
python3 seed_knowledge_base.py

# 3. Upload to S3 (optional backup)
python3 upload_to_s3.py --dry-run  # Preview
python3 upload_to_s3.py            # Upload
```

## What Gets Seeded?

**6 documents** across 3 categories:

| Category | Documents | Topics |
|----------|-----------|--------|
| **Algorithms** | 2 | Dynamic Programming, Graphs (BFS/DFS) |
| **Patterns** | 2 | Sliding Window, Two Pointers |
| **Debugging** | 2 | Time Limit Exceeded, Wrong Answer |

## Architecture

```
Local Documents → Titan Embeddings → DynamoDB (vector storage)
                                  ↓
                              S3 (optional backup)
```

**Budget Impact**: ~$0.58/month (well within $70-95 target)

## Prerequisites

```bash
# AWS credentials
export AWS_DEFAULT_REGION=ap-south-1
export AWS_REGION=ap-south-1

# Python dependencies
pip install boto3 pyyaml numpy
```

## Step-by-Step

### 1. Test Locally (No AWS)

```bash
cd lambda-functions/rag
python3 test_seeding.py
```

**Expected**: ✅ 7 tests passed

### 2. Seed DynamoDB

```bash
python3 seed_knowledge_base.py
```

**Expected Output**:
- Documents processed: 6
- Chunks created: ~8-18
- Embeddings generated: ~8-18
- Duration: ~10-30 seconds

### 3. Verify DynamoDB

```bash
aws dynamodb scan --table-name KnowledgeBase --select COUNT
```

**Expected**: Count: 8-18 items

### 4. Test RAG Retrieval

```bash
python3 -c "
from index import retrieve_knowledge
results = retrieve_knowledge('Explain dynamic programming', {'total_solved': 50}, 3)
print(f'Retrieved {len(results)} results')
for r in results:
    print(f'  - {r[\"title\"]} (score: {r[\"score\"]:.4f})')
"
```

**Expected**: 3 results with relevant titles

### 5. Upload to S3 (Optional)

```bash
# Preview
python3 upload_to_s3.py --dry-run

# Upload
python3 upload_to_s3.py

# Verify
python3 upload_to_s3.py --verify-only
```

## Troubleshooting

### "No documents found"
```bash
# Check you're in the right directory
pwd  # Should end with /lambda-functions/rag
ls knowledge_base/  # Should show algorithms/, patterns/, debugging/
```

### "Bedrock access denied"
```bash
# Add Bedrock permissions
aws iam attach-role-policy \
  --role-name CodeFlowLambdaRole \
  --policy-arn arn:aws:iam::aws:policy/AmazonBedrockFullAccess
```

### "DynamoDB table not found"
```bash
# Create table
aws dynamodb create-table \
  --table-name KnowledgeBase \
  --attribute-definitions AttributeName=doc_id,AttributeType=S \
  --key-schema AttributeName=doc_id,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region ap-south-1
```

## Adding New Documents

1. Create markdown file with frontmatter:
```bash
cat > knowledge_base/algorithms/binary-search.md << 'EOF'
---
title: "Binary Search Techniques"
category: algorithms
complexity: easy
topics: [binary-search, arrays]
---

# Binary Search
...
EOF
```

2. Re-run seeding:
```bash
python3 seed_knowledge_base.py
```

3. Verify:
```bash
python3 -c "
from index import retrieve_knowledge
results = retrieve_knowledge('binary search', {'total_solved': 10}, 3)
assert any('Binary Search' in r['title'] for r in results)
print('✅ New document found!')
"
```

## Next Steps

After seeding:

1. **Deploy RAG Lambda**: Update Lambda function code
2. **Integrate with Chat Mentor**: Already integrated in `chat-mentor/index.py`
3. **Monitor Performance**: Check CloudWatch metrics
4. **Expand Knowledge Base**: Add more documents (target: 20-50)

## Cost Breakdown

| Component | Monthly Cost |
|-----------|--------------|
| DynamoDB Storage | $0.03 |
| DynamoDB Reads | $0.25 |
| Lambda Invocations | $0.20 |
| Titan Embeddings | $0.10 |
| S3 Storage | $0.001 |
| **Total** | **$0.58** |

## Documentation

- [Full Seeding Guide](./SEEDING-GUIDE.md) - Comprehensive documentation
- [Implementation Summary](./IMPLEMENTATION-SUMMARY.md) - Technical details
- [RAG README](./README.md) - API documentation

## Support

Questions? Check:
1. [Troubleshooting](#troubleshooting) section above
2. [SEEDING-GUIDE.md](./SEEDING-GUIDE.md) for detailed help
3. CloudWatch logs: `/aws/lambda/rag-function`

# OpenSearch Initialization Guide

This guide explains how to initialize the Amazon OpenSearch domain with k-NN enabled indices for vector search.

## Overview

The CodeFlow AI platform uses Amazon OpenSearch Service for vector search with the following configuration:

- **Instance Type**: r6g.large.search (2 nodes)
- **Storage**: 100GB EBS per node (GP3)
- **Engine**: OpenSearch 2.11
- **k-NN Algorithm**: HNSW (Hierarchical Navigable Small World)
- **Distance Metric**: Cosine similarity
- **Vector Dimensions**: 1536 (Titan Embeddings)

## Indices

Three indices are created for different knowledge base categories:

1. **codeflow-algorithms**: Algorithm explanations and patterns
2. **codeflow-patterns**: Common coding patterns (sliding window, two pointers, etc.)
3. **codeflow-debugging**: Debugging guides and tips

## Prerequisites

Before running the initialization script, ensure you have:

1. AWS credentials configured with permissions to access OpenSearch
2. Python 3.8+ installed
3. Required Python packages installed:

```bash
pip install boto3 opensearch-py requests-aws4auth
```

## Usage

### 1. Deploy the CDK Stack

First, deploy the infrastructure stack to create the OpenSearch domain:

```bash
cd infrastructure
npm install
cdk deploy --context environmentName=dev
```

This will output the OpenSearch domain endpoint. Note this endpoint for the next step.

### 2. Initialize Indices

Run the initialization script to create the k-NN enabled indices:

```bash
cd infrastructure/scripts

# Replace with your actual OpenSearch endpoint (without https://)
python init-opensearch-indices.py \
  --endpoint search-codeflow-opensearch-dev-xxxxx.us-east-1.es.amazonaws.com \
  --region us-east-1
```

Expected output:

```
Connecting to OpenSearch domain: search-codeflow-opensearch-dev-xxxxx.us-east-1.es.amazonaws.com
Region: us-east-1

✓ Successfully connected to OpenSearch

Creating indices with k-NN configuration...

✓ Successfully created index 'codeflow-algorithms'
✓ Index 'codeflow-algorithms' verified: k-NN enabled
✓ Successfully created index 'codeflow-patterns'
✓ Index 'codeflow-patterns' verified: k-NN enabled
✓ Successfully created index 'codeflow-debugging'
✓ Index 'codeflow-debugging' verified: k-NN enabled

Summary: 3/3 indices created and verified successfully
✓ All indices are ready for vector search!
```

### 3. Verify Indices (Optional)

To verify existing indices without creating new ones:

```bash
python init-opensearch-indices.py \
  --endpoint search-codeflow-opensearch-dev-xxxxx.us-east-1.es.amazonaws.com \
  --region us-east-1 \
  --verify-only
```

## Index Configuration Details

Each index is configured with the following settings:

### k-NN Settings

```json
{
  "settings": {
    "index": {
      "knn": true,
      "knn.algo_param.ef_search": 512,
      "number_of_shards": 2,
      "number_of_replicas": 1
    }
  }
}
```

### Vector Field Configuration

```json
{
  "embedding": {
    "type": "knn_vector",
    "dimension": 1536,
    "method": {
      "name": "hnsw",
      "space_type": "cosinesimil",
      "engine": "nmslib",
      "parameters": {
        "ef_construction": 512,
        "m": 16
      }
    }
  }
}
```

### HNSW Parameters

- **ef_construction**: 512 - Controls index build time vs. accuracy tradeoff
- **m**: 16 - Number of bi-directional links per node
- **ef_search**: 512 - Controls search time vs. accuracy tradeoff

## Accessing OpenSearch Dashboards

After deployment, you can access OpenSearch Dashboards at:

```
https://<opensearch-endpoint>/_dashboards
```

Use the master user credentials configured in the CDK stack to log in.

## Troubleshooting

### Connection Timeout

If you get a connection timeout error, ensure:

1. Your Lambda functions or EC2 instances are in the same VPC as OpenSearch
2. Security groups allow traffic on port 443
3. VPC subnets have proper routing configured

### Authentication Errors

If you get authentication errors:

1. Verify your AWS credentials have the necessary permissions
2. Check that the OpenSearch access policy allows your IP or VPC CIDR
3. Ensure fine-grained access control is properly configured

### Index Creation Fails

If index creation fails:

1. Check that the OpenSearch domain is in "Active" state
2. Verify the domain has sufficient storage and memory
3. Check CloudWatch logs for detailed error messages

## Next Steps

After initializing the indices, you can:

1. Upload knowledge base documents to S3 (`codeflow-kb-documents` bucket)
2. Run the embedding generation pipeline to populate the indices
3. Test vector search queries using the OpenSearch API
4. Configure Bedrock Knowledge Bases to use these indices

## References

- [Amazon OpenSearch Service Documentation](https://docs.aws.amazon.com/opensearch-service/)
- [k-NN Plugin Documentation](https://opensearch.org/docs/latest/search-plugins/knn/index/)
- [HNSW Algorithm](https://arxiv.org/abs/1603.09320)
- [Cosine Similarity](https://en.wikipedia.org/wiki/Cosine_similarity)

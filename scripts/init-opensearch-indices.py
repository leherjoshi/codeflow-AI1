#!/usr/bin/env python3
"""
Initialize OpenSearch indices with k-NN configuration for vector search.

This script creates three indices:
- codeflow-algorithms: Algorithm explanations and patterns
- codeflow-patterns: Common coding patterns (sliding window, two pointers, etc.)
- codeflow-debugging: Debugging guides and tips

Each index is configured with:
- k-NN plugin enabled
- HNSW algorithm for approximate nearest neighbor search
- Cosine similarity distance metric
- 1536-dimensional vectors (Titan Embeddings)
"""

import json
import sys
import argparse
from typing import Dict, Any
import boto3
from opensearchpy import OpenSearch, RequestsHttpConnection
from requests_aws4auth import AWS4Auth


def get_opensearch_client(endpoint: str, region: str) -> OpenSearch:
    """
    Create an OpenSearch client with AWS authentication.
    
    Args:
        endpoint: OpenSearch domain endpoint (without https://)
        region: AWS region
        
    Returns:
        OpenSearch client instance
    """
    credentials = boto3.Session().get_credentials()
    awsauth = AWS4Auth(
        credentials.access_key,
        credentials.secret_key,
        region,
        'es',
        session_token=credentials.token
    )
    
    client = OpenSearch(
        hosts=[{'host': endpoint, 'port': 443}],
        http_auth=awsauth,
        use_ssl=True,
        verify_certs=True,
        connection_class=RequestsHttpConnection,
        timeout=30,
    )
    
    return client


def get_index_mapping() -> Dict[str, Any]:
    """
    Get the index mapping configuration for k-NN vector search.
    
    Returns:
        Index mapping configuration with k-NN settings
    """
    return {
        "settings": {
            "index": {
                "knn": True,  # Enable k-NN plugin
                "knn.algo_param.ef_search": 512,  # HNSW search parameter
                "number_of_shards": 2,
                "number_of_replicas": 1,
            }
        },
        "mappings": {
            "properties": {
                "doc_id": {
                    "type": "keyword"
                },
                "title": {
                    "type": "text",
                    "analyzer": "standard"
                },
                "content": {
                    "type": "text",
                    "analyzer": "standard"
                },
                "embedding": {
                    "type": "knn_vector",
                    "dimension": 1536,  # Titan Embeddings dimension
                    "method": {
                        "name": "hnsw",  # Hierarchical Navigable Small World algorithm
                        "space_type": "cosinesimil",  # Cosine similarity distance metric
                        "engine": "nmslib",
                        "parameters": {
                            "ef_construction": 512,  # HNSW construction parameter
                            "m": 16  # Number of bi-directional links per node
                        }
                    }
                },
                "category": {
                    "type": "keyword"
                },
                "subcategory": {
                    "type": "keyword"
                },
                "complexity": {
                    "type": "keyword"
                },
                "topics": {
                    "type": "keyword"
                },
                "metadata": {
                    "type": "object",
                    "properties": {
                        "source": {
                            "type": "keyword"
                        },
                        "last_updated": {
                            "type": "date"
                        },
                        "author": {
                            "type": "keyword"
                        }
                    }
                },
                "created_at": {
                    "type": "date"
                },
                "updated_at": {
                    "type": "date"
                }
            }
        }
    }


def create_index(client: OpenSearch, index_name: str, mapping: Dict[str, Any]) -> bool:
    """
    Create an OpenSearch index with the specified mapping.
    
    Args:
        client: OpenSearch client
        index_name: Name of the index to create
        mapping: Index mapping configuration
        
    Returns:
        True if index was created successfully, False otherwise
    """
    try:
        # Check if index already exists
        if client.indices.exists(index=index_name):
            print(f"Index '{index_name}' already exists. Skipping creation.")
            return True
        
        # Create the index
        response = client.indices.create(
            index=index_name,
            body=mapping
        )
        
        if response.get('acknowledged'):
            print(f"✓ Successfully created index '{index_name}'")
            return True
        else:
            print(f"✗ Failed to create index '{index_name}': {response}")
            return False
            
    except Exception as e:
        print(f"✗ Error creating index '{index_name}': {str(e)}")
        return False


def verify_index(client: OpenSearch, index_name: str) -> bool:
    """
    Verify that an index exists and has k-NN enabled.
    
    Args:
        client: OpenSearch client
        index_name: Name of the index to verify
        
    Returns:
        True if index exists and is configured correctly, False otherwise
    """
    try:
        # Get index settings
        settings = client.indices.get_settings(index=index_name)
        index_settings = settings[index_name]['settings']['index']
        
        # Check if k-NN is enabled
        knn_enabled = index_settings.get('knn', 'false') == 'true'
        
        if knn_enabled:
            print(f"✓ Index '{index_name}' verified: k-NN enabled")
            return True
        else:
            print(f"✗ Index '{index_name}' verification failed: k-NN not enabled")
            return False
            
    except Exception as e:
        print(f"✗ Error verifying index '{index_name}': {str(e)}")
        return False


def main():
    """Main function to initialize OpenSearch indices."""
    parser = argparse.ArgumentParser(
        description='Initialize OpenSearch indices with k-NN configuration'
    )
    parser.add_argument(
        '--endpoint',
        required=True,
        help='OpenSearch domain endpoint (without https://)'
    )
    parser.add_argument(
        '--region',
        default='ap-south-1',
        help='AWS region (default: ap-south-1 - Mumbai)'
    )
    parser.add_argument(
        '--verify-only',
        action='store_true',
        help='Only verify existing indices without creating new ones'
    )
    
    args = parser.parse_args()
    
    print(f"Connecting to OpenSearch domain: {args.endpoint}")
    print(f"Region: {args.region}")
    print()
    
    # Create OpenSearch client
    try:
        client = get_opensearch_client(args.endpoint, args.region)
        print("✓ Successfully connected to OpenSearch")
        print()
    except Exception as e:
        print(f"✗ Failed to connect to OpenSearch: {str(e)}")
        sys.exit(1)
    
    # Define indices to create
    indices = [
        'codeflow-algorithms',
        'codeflow-patterns',
        'codeflow-debugging',
    ]
    
    # Get index mapping configuration
    mapping = get_index_mapping()
    
    # Create or verify indices
    success_count = 0
    
    if args.verify_only:
        print("Verifying existing indices...")
        print()
        for index_name in indices:
            if verify_index(client, index_name):
                success_count += 1
    else:
        print("Creating indices with k-NN configuration...")
        print()
        for index_name in indices:
            if create_index(client, index_name, mapping):
                if verify_index(client, index_name):
                    success_count += 1
    
    print()
    print(f"Summary: {success_count}/{len(indices)} indices {'verified' if args.verify_only else 'created and verified'} successfully")
    
    if success_count == len(indices):
        print("✓ All indices are ready for vector search!")
        sys.exit(0)
    else:
        print("✗ Some indices failed. Please check the errors above.")
        sys.exit(1)


if __name__ == '__main__':
    main()

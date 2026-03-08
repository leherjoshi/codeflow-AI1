#!/usr/bin/env python3
"""
Knowledge Base Seeding Script

This script seeds the DynamoDB knowledge base with embeddings for all documents.
It replaces the OpenSearch indexing mentioned in the original task.

Usage:
    python3 seed_knowledge_base.py [--local]

Options:
    --local     Use local DynamoDB (for testing)
"""

import sys
import os
import argparse
from datetime import datetime

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(__file__))

from index import (
    generate_embeddings_for_knowledge_base,
    vector_search,
    retrieve_knowledge
)


def seed_knowledge_base(local: bool = False):
    """
    Seed the knowledge base with embeddings
    
    Args:
        local: Use local DynamoDB for testing
    """
    print("=" * 80)
    print("CodeFlow AI - Knowledge Base Seeding")
    print("=" * 80)
    print()
    
    if local:
        print("⚠️  Using LOCAL DynamoDB (for testing)")
        os.environ['AWS_ENDPOINT_URL'] = 'http://localhost:8000'
    else:
        print("☁️  Using AWS DynamoDB (production)")
    
    print()
    print("Starting embedding generation...")
    print("-" * 80)
    
    # Generate embeddings (use relative path when running from rag directory)
    start_time = datetime.now()
    
    try:
        stats = generate_embeddings_for_knowledge_base(documents_path='knowledge_base')
        
        end_time = datetime.now()
        duration = (end_time - start_time).total_seconds()
        
        print()
        print("=" * 80)
        print("✅ Embedding Generation Complete")
        print("=" * 80)
        print()
        print(f"📊 Statistics:")
        print(f"  - Documents processed: {stats['documents_processed']}")
        print(f"  - Chunks created: {stats['chunks_created']}")
        print(f"  - Embeddings generated: {stats['embeddings_generated']}")
        print(f"  - Errors: {len(stats['errors'])}")
        print(f"  - Duration: {duration:.2f} seconds")
        print()
        
        if stats['errors']:
            print("⚠️  Errors encountered:")
            for error in stats['errors']:
                print(f"  - {error}")
            print()
        
        return stats
    
    except Exception as e:
        print()
        print("=" * 80)
        print("❌ Embedding Generation Failed")
        print("=" * 80)
        print()
        print(f"Error: {str(e)}")
        print()
        raise


def test_rag_retrieval():
    """
    Test RAG retrieval with sample queries
    """
    print("=" * 80)
    print("Testing RAG Retrieval")
    print("=" * 80)
    print()
    
    test_queries = [
        {
            'query': 'Explain dynamic programming',
            'user_context': {'total_solved': 50},
            'expected_category': 'algorithms'
        },
        {
            'query': 'How do I use sliding window pattern?',
            'user_context': {'total_solved': 30},
            'expected_category': 'patterns'
        },
        {
            'query': 'My solution is getting time limit exceeded',
            'user_context': {'total_solved': 20},
            'expected_category': 'debugging'
        },
        {
            'query': 'What is BFS and when should I use it?',
            'user_context': {'total_solved': 100},
            'expected_category': 'algorithms'
        }
    ]
    
    all_passed = True
    
    for i, test in enumerate(test_queries, 1):
        print(f"Test {i}: {test['query']}")
        print("-" * 80)
        
        try:
            results = retrieve_knowledge(
                query=test['query'],
                user_context=test['user_context'],
                top_k=3
            )
            
            if not results:
                print("❌ No results returned")
                all_passed = False
                print()
                continue
            
            print(f"✅ Retrieved {len(results)} results")
            print()
            
            for j, result in enumerate(results, 1):
                print(f"  Result {j}:")
                print(f"    Title: {result['title']}")
                print(f"    Category: {result['category']}")
                print(f"    Complexity: {result['complexity']}")
                print(f"    Score: {result['score']:.4f}")
                print(f"    Content: {result['content'][:100]}...")
                print()
            
            # Verify expected category
            if results[0]['category'] == test['expected_category']:
                print(f"✅ Top result matches expected category: {test['expected_category']}")
            else:
                print(f"⚠️  Top result category ({results[0]['category']}) doesn't match expected ({test['expected_category']})")
            
            print()
        
        except Exception as e:
            print(f"❌ Error: {str(e)}")
            all_passed = False
            print()
    
    print("=" * 80)
    if all_passed:
        print("✅ All RAG retrieval tests passed")
    else:
        print("⚠️  Some RAG retrieval tests failed")
    print("=" * 80)
    print()
    
    return all_passed


def verify_dynamodb_indices():
    """
    Verify DynamoDB table has been populated
    """
    print("=" * 80)
    print("Verifying DynamoDB Indices")
    print("=" * 80)
    print()
    
    try:
        import boto3
        
        dynamodb = boto3.resource('dynamodb')
        table_name = os.environ.get('KNOWLEDGE_BASE_TABLE', 'KnowledgeBase')
        table = dynamodb.Table(table_name)
        
        # Scan table to count items
        response = table.scan(Select='COUNT')
        item_count = response.get('Count', 0)
        
        print(f"📊 DynamoDB Table: {table_name}")
        print(f"  - Total items: {item_count}")
        print()
        
        if item_count > 0:
            print("✅ DynamoDB table is populated")
            
            # Get sample item
            sample_response = table.scan(Limit=1)
            if sample_response.get('Items'):
                sample_item = sample_response['Items'][0]
                print()
                print("Sample item:")
                print(f"  - doc_id: {sample_item.get('doc_id')}")
                print(f"  - title: {sample_item.get('title')}")
                print(f"  - category: {sample_item.get('category')}")
                print(f"  - complexity: {sample_item.get('complexity')}")
                print(f"  - chunk_index: {sample_item.get('chunk_index')}/{sample_item.get('total_chunks')}")
                print()
        else:
            print("⚠️  DynamoDB table is empty")
        
        print()
        return item_count > 0
    
    except Exception as e:
        print(f"❌ Error verifying DynamoDB: {str(e)}")
        print()
        return False


def main():
    """
    Main entry point
    """
    parser = argparse.ArgumentParser(
        description='Seed CodeFlow AI knowledge base with embeddings'
    )
    parser.add_argument(
        '--local',
        action='store_true',
        help='Use local DynamoDB for testing'
    )
    parser.add_argument(
        '--skip-seeding',
        action='store_true',
        help='Skip seeding and only test retrieval'
    )
    parser.add_argument(
        '--skip-testing',
        action='store_true',
        help='Skip testing and only seed'
    )
    
    args = parser.parse_args()
    
    try:
        # Step 1: Seed knowledge base
        if not args.skip_seeding:
            stats = seed_knowledge_base(local=args.local)
            
            if stats['documents_processed'] == 0:
                print("⚠️  No documents were processed. Check the knowledge_base directory.")
                return 1
        
        # Step 2: Verify DynamoDB
        if not args.skip_testing:
            print()
            if not verify_dynamodb_indices():
                print("⚠️  DynamoDB verification failed")
                return 1
        
        # Step 3: Test RAG retrieval
        if not args.skip_testing:
            print()
            if not test_rag_retrieval():
                print("⚠️  RAG retrieval tests failed")
                return 1
        
        # Success
        print()
        print("=" * 80)
        print("🎉 Knowledge Base Seeding Complete!")
        print("=" * 80)
        print()
        print("Next steps:")
        print("  1. Deploy the RAG Lambda function to AWS")
        print("  2. Integrate with chat-mentor service")
        print("  3. Monitor CloudWatch metrics for RAG performance")
        print()
        
        return 0
    
    except Exception as e:
        print()
        print("=" * 80)
        print("❌ Knowledge Base Seeding Failed")
        print("=" * 80)
        print()
        print(f"Error: {str(e)}")
        print()
        return 1


if __name__ == '__main__':
    sys.exit(main())

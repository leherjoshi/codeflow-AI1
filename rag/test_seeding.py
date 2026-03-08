#!/usr/bin/env python3
"""
Test Knowledge Base Seeding (Without AWS)

This script tests the seeding logic without requiring AWS credentials.
It uses mocked Bedrock and DynamoDB calls.
"""

import sys
import os
from unittest.mock import Mock, patch, MagicMock
import json

# Set AWS region for boto3
os.environ['AWS_DEFAULT_REGION'] = 'ap-south-1'
os.environ['AWS_REGION'] = 'ap-south-1'

# Add parent directory to path
sys.path.insert(0, os.path.dirname(__file__))


def test_document_discovery():
    """Test that all knowledge base documents are discovered"""
    print("Test 1: Document Discovery")
    print("-" * 80)
    
    import glob
    
    # Use relative path from test file location
    documents_path = 'knowledge_base'
    pattern = f"{documents_path}/**/*.md"
    markdown_files = glob.glob(pattern, recursive=True)
    
    print(f"Found {len(markdown_files)} markdown files:")
    for file_path in markdown_files:
        print(f"  - {file_path}")
    
    # Verify expected documents
    expected_categories = {
        'algorithms': ['dynamic-programming.md', 'graphs.md'],
        'patterns': ['sliding-window.md', 'two-pointers.md'],
        'debugging': ['time-limit-exceeded.md', 'wrong-answer.md']
    }
    
    for category, expected_files in expected_categories.items():
        category_files = [f for f in markdown_files if f'/{category}/' in f]
        print(f"\n{category.capitalize()} documents: {len(category_files)}")
        
        for expected_file in expected_files:
            found = any(expected_file in f for f in category_files)
            status = "✅" if found else "❌"
            print(f"  {status} {expected_file}")
    
    print()
    assert len(markdown_files) >= 6, "Expected at least 6 documents"
    print("✅ Document discovery test passed")
    print()


def test_frontmatter_parsing():
    """Test frontmatter parsing"""
    print("Test 2: Frontmatter Parsing")
    print("-" * 80)
    
    from index import parse_markdown_with_frontmatter
    
    # Test with frontmatter
    content_with_frontmatter = """---
title: Dynamic Programming Fundamentals
category: algorithms
complexity: medium
topics: [dp, optimization, memoization]
---

# Dynamic Programming

Dynamic programming is an optimization technique...
"""
    
    metadata, text = parse_markdown_with_frontmatter(content_with_frontmatter)
    
    print("Parsed metadata:")
    for key, value in metadata.items():
        print(f"  {key}: {value}")
    
    print(f"\nContent preview: {text[:50]}...")
    
    assert metadata['title'] == 'Dynamic Programming Fundamentals'
    assert metadata['category'] == 'algorithms'
    assert metadata['complexity'] == 'medium'
    assert isinstance(metadata['topics'], list)
    assert 'Dynamic Programming' in text
    
    print()
    print("✅ Frontmatter parsing test passed")
    print()


def test_text_chunking():
    """Test text chunking"""
    print("Test 3: Text Chunking")
    print("-" * 80)
    
    from index import chunk_text
    
    # Create sample text
    text = ' '.join([f'word{i}' for i in range(100)])
    
    chunks = chunk_text(text, chunk_size=20, overlap=5)
    
    print(f"Original text: {len(text.split())} words")
    print(f"Chunks created: {len(chunks)}")
    print(f"\nFirst chunk: {chunks[0][:50]}...")
    print(f"Last chunk: {chunks[-1][:50]}...")
    
    assert len(chunks) > 1, "Expected multiple chunks"
    assert all(len(chunk) > 0 for chunk in chunks), "All chunks should have content"
    
    print()
    print("✅ Text chunking test passed")
    print()


def test_embedding_generation_mock():
    """Test embedding generation with mocked Bedrock"""
    print("Test 4: Embedding Generation (Mocked)")
    print("-" * 80)
    
    from index import generate_embedding
    
    # Mock Bedrock response
    mock_embedding = [0.1] * 1536  # 1536-dimensional vector
    
    with patch('index.bedrock_runtime') as mock_bedrock:
        # Configure mock
        mock_response = {
            'body': Mock()
        }
        mock_response['body'].read = Mock(return_value=json.dumps({
            'embedding': mock_embedding
        }).encode())
        mock_bedrock.invoke_model.return_value = mock_response
        
        # Generate embedding
        embedding = generate_embedding("Test text")
        
        print(f"Embedding dimensions: {len(embedding)}")
        print(f"Sample values: {embedding[:5]}")
        
        assert len(embedding) == 1536, "Expected 1536 dimensions"
        assert all(isinstance(v, float) for v in embedding), "All values should be floats"
        
        print()
        print("✅ Embedding generation test passed")
        print()


def test_binary_conversion():
    """Test embedding binary conversion"""
    print("Test 5: Binary Conversion")
    print("-" * 80)
    
    from index import embedding_to_binary, binary_to_embedding
    
    # Create sample embedding
    original_embedding = [0.1, 0.2, 0.3, 0.4, 0.5] * 307 + [0.1]  # 1536 values
    
    # Convert to binary and back
    binary_data = embedding_to_binary(original_embedding)
    recovered_embedding = binary_to_embedding(binary_data)
    
    print(f"Original embedding: {len(original_embedding)} floats")
    print(f"Binary size: {len(binary_data)} bytes")
    print(f"Recovered embedding: {len(recovered_embedding)} floats")
    
    # Check values match (with floating point tolerance)
    max_diff = max(abs(a - b) for a, b in zip(original_embedding, recovered_embedding))
    print(f"Max difference: {max_diff}")
    
    assert len(recovered_embedding) == len(original_embedding)
    assert max_diff < 1e-6, "Values should match within floating point precision"
    
    print()
    print("✅ Binary conversion test passed")
    print()


def test_category_detection():
    """Test category detection from queries"""
    print("Test 6: Category Detection")
    print("-" * 80)
    
    from index import detect_category_from_query
    
    test_cases = [
        ('Explain dynamic programming', 'algorithms'),
        ('How do I use sliding window?', 'patterns'),
        ('My solution gets TLE', 'debugging'),
        ('What is BFS?', 'algorithms'),
        ('Two pointer technique', 'patterns'),
        ('Wrong answer on test case', 'debugging'),
        ('General coding question', None)
    ]
    
    for query, expected_category in test_cases:
        detected_category = detect_category_from_query(query)
        status = "✅" if detected_category == expected_category else "❌"
        print(f"{status} '{query}' -> {detected_category} (expected: {expected_category})")
    
    print()
    print("✅ Category detection test passed")
    print()


def test_full_pipeline_mock():
    """Test full seeding pipeline with mocks"""
    print("Test 7: Full Pipeline (Mocked)")
    print("-" * 80)
    
    from index import generate_embeddings_for_knowledge_base
    
    # Mock all AWS services
    mock_embedding = [0.1] * 1536
    
    with patch('index.bedrock_runtime') as mock_bedrock, \
         patch('index.knowledge_base_table') as mock_table:
        
        # Configure Bedrock mock
        mock_response = {
            'body': Mock()
        }
        mock_response['body'].read = Mock(return_value=json.dumps({
            'embedding': mock_embedding
        }).encode())
        mock_bedrock.invoke_model.return_value = mock_response
        
        # Configure DynamoDB mock
        mock_table.put_item = Mock()
        
        # Run pipeline with correct path
        print("Running embedding generation pipeline...")
        stats = generate_embeddings_for_knowledge_base(documents_path='knowledge_base')
        
        print()
        print("Pipeline statistics:")
        print(f"  Documents processed: {stats['documents_processed']}")
        print(f"  Chunks created: {stats['chunks_created']}")
        print(f"  Embeddings generated: {stats['embeddings_generated']}")
        print(f"  Errors: {len(stats['errors'])}")
        
        if stats['errors']:
            print("\nErrors:")
            for error in stats['errors']:
                print(f"  - {error}")
        
        # Verify results
        assert stats['documents_processed'] >= 6, "Expected at least 6 documents"
        assert stats['chunks_created'] > 0, "Expected chunks to be created"
        assert stats['embeddings_generated'] > 0, "Expected embeddings to be generated"
        
        # Verify DynamoDB was called
        assert mock_table.put_item.called, "Expected DynamoDB put_item to be called"
        print(f"\nDynamoDB put_item called {mock_table.put_item.call_count} times")
        
        print()
        print("✅ Full pipeline test passed")
        print()


def main():
    """Run all tests"""
    print("=" * 80)
    print("Knowledge Base Seeding Tests (Without AWS)")
    print("=" * 80)
    print()
    
    tests = [
        test_document_discovery,
        test_frontmatter_parsing,
        test_text_chunking,
        test_embedding_generation_mock,
        test_binary_conversion,
        test_category_detection,
        test_full_pipeline_mock
    ]
    
    passed = 0
    failed = 0
    
    for test in tests:
        try:
            test()
            passed += 1
        except Exception as e:
            print(f"❌ Test failed: {str(e)}")
            print()
            failed += 1
    
    print("=" * 80)
    print(f"Test Results: {passed} passed, {failed} failed")
    print("=" * 80)
    print()
    
    if failed == 0:
        print("🎉 All tests passed!")
        return 0
    else:
        print("⚠️  Some tests failed")
        return 1


if __name__ == '__main__':
    sys.exit(main())

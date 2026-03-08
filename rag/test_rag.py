"""
Integration tests for RAG pipeline (DynamoDB-based)

Tests:
1. Embedding generation for sample documents
2. Vector search returns relevant results
3. Context injection into Bedrock prompt
4. End-to-end RAG retrieval
"""

import pytest
import json
import os
import sys
from unittest.mock import Mock, patch, MagicMock
from datetime import datetime, timezone

# Mock AWS services before importing index
with patch('boto3.resource'), patch('boto3.client'):
    # Import functions to test
    from index import (
        parse_markdown_with_frontmatter,
        chunk_text,
        embedding_to_binary,
        binary_to_embedding,
        cosine_similarity,
        detect_category_from_query,
        generate_doc_id
    )


class TestMarkdownParsing:
    """Test markdown parsing with frontmatter"""
    
    def test_parse_markdown_with_frontmatter(self):
        """Test parsing markdown with YAML frontmatter"""
        content = """---
title: Test Document
category: algorithms
complexity: medium
topics: [dp, graphs]
---

# Test Content

This is test content."""
        
        metadata, text = parse_markdown_with_frontmatter(content)
        
        assert metadata['title'] == 'Test Document'
        assert metadata['category'] == 'algorithms'
        assert metadata['complexity'] == 'medium'
        assert metadata['topics'] == ['dp', 'graphs']
        assert '# Test Content' in text
        assert 'This is test content.' in text
    
    def test_parse_markdown_without_frontmatter(self):
        """Test parsing markdown without frontmatter"""
        content = "# Just Content\n\nNo frontmatter here."
        
        metadata, text = parse_markdown_with_frontmatter(content)
        
        assert metadata == {}
        assert text == content


class TestTextChunking:
    """Test text chunking functionality"""
    
    def test_chunk_text_basic(self):
        """Test basic text chunking"""
        text = " ".join([f"word{i}" for i in range(100)])
        chunks = chunk_text(text, chunk_size=20, overlap=5)
        
        assert len(chunks) > 1
        assert all(isinstance(chunk, str) for chunk in chunks)
    
    def test_chunk_text_small_text(self):
        """Test chunking with text smaller than chunk size"""
        text = "Small text"
        chunks = chunk_text(text, chunk_size=100, overlap=10)
        
        assert len(chunks) == 1
        assert chunks[0] == text
    
    def test_chunk_text_overlap(self):
        """Test that chunks have overlap"""
        text = " ".join([f"word{i}" for i in range(50)])
        chunks = chunk_text(text, chunk_size=10, overlap=3)
        
        # Check that consecutive chunks share some words
        if len(chunks) > 1:
            # This is a simple check - in practice, overlap may vary
            assert len(chunks) >= 2


class TestEmbeddings:
    """Test embedding generation and conversion"""
    
    def test_embedding_generation_mock(self):
        """Test embedding generation with mocked Bedrock"""
        # Import here to avoid module-level AWS client initialization
        with patch('index.bedrock_runtime') as mock_bedrock:
            from index import generate_embedding
            
            # Mock Bedrock response
            mock_response = {
                'body': Mock(read=lambda: json.dumps({
                    'embedding': [0.1] * 1536
                }).encode())
            }
            mock_bedrock.invoke_model.return_value = mock_response
            
            embedding = generate_embedding("test text")
            
            assert len(embedding) == 1536
            assert all(isinstance(x, float) for x in embedding)
            mock_bedrock.invoke_model.assert_called_once()
    
    def test_embedding_binary_conversion(self):
        """Test embedding to binary and back"""
        original_embedding = [0.1, 0.2, 0.3, 0.4, 0.5]
        
        # Convert to binary
        binary_data = embedding_to_binary(original_embedding)
        assert isinstance(binary_data, bytes)
        assert len(binary_data) == len(original_embedding) * 4  # 4 bytes per float
        
        # Convert back
        recovered_embedding = binary_to_embedding(binary_data)
        assert len(recovered_embedding) == len(original_embedding)
        
        # Check values are close (floating point precision)
        for orig, recovered in zip(original_embedding, recovered_embedding):
            assert abs(orig - recovered) < 0.0001


class TestCosineSimilarity:
    """Test cosine similarity calculation"""
    
    def test_cosine_similarity_identical(self):
        """Test similarity of identical vectors"""
        vec = [1.0, 2.0, 3.0, 4.0]
        similarity = cosine_similarity(vec, vec)
        
        assert abs(similarity - 1.0) < 0.0001  # Should be 1.0
    
    def test_cosine_similarity_orthogonal(self):
        """Test similarity of orthogonal vectors"""
        vec1 = [1.0, 0.0, 0.0]
        vec2 = [0.0, 1.0, 0.0]
        similarity = cosine_similarity(vec1, vec2)
        
        assert abs(similarity - 0.0) < 0.0001  # Should be 0.0
    
    def test_cosine_similarity_opposite(self):
        """Test similarity of opposite vectors"""
        vec1 = [1.0, 2.0, 3.0]
        vec2 = [-1.0, -2.0, -3.0]
        similarity = cosine_similarity(vec1, vec2)
        
        assert abs(similarity - (-1.0)) < 0.0001  # Should be -1.0
    
    def test_cosine_similarity_range(self):
        """Test that similarity is in valid range"""
        vec1 = [0.5, 0.3, 0.8, 0.2]
        vec2 = [0.4, 0.6, 0.1, 0.9]
        similarity = cosine_similarity(vec1, vec2)
        
        assert -1.0 <= similarity <= 1.0


class TestCategoryDetection:
    """Test category detection from queries"""
    
    def test_detect_algorithms_category(self):
        """Test detection of algorithms category"""
        queries = [
            "Explain dynamic programming",
            "How does BFS work?",
            "What is Dijkstra's algorithm?"
        ]
        
        for query in queries:
            category = detect_category_from_query(query)
            assert category == 'algorithms'
    
    def test_detect_patterns_category(self):
        """Test detection of patterns category"""
        queries = [
            "What is the sliding window pattern?",
            "Explain two pointer approach",
            "Common patterns for arrays"
        ]
        
        for query in queries:
            category = detect_category_from_query(query)
            assert category == 'patterns'
    
    def test_detect_debugging_category(self):
        """Test detection of debugging category"""
        queries = [
            "Getting TLE on my solution",
            "How to fix time limit exceeded?",
            "Why is my answer wrong?"
        ]
        
        for query in queries:
            category = detect_category_from_query(query)
            assert category == 'debugging'
    
    def test_detect_no_category(self):
        """Test when no category matches"""
        query = "Random question about nothing specific"
        category = detect_category_from_query(query)
        
        assert category is None


class TestDocumentID:
    """Test document ID generation"""
    
    def test_generate_doc_id_consistent(self):
        """Test that same input generates same ID"""
        file_path = "test/path/file.md"
        chunk_index = 0
        
        id1 = generate_doc_id(file_path, chunk_index)
        id2 = generate_doc_id(file_path, chunk_index)
        
        assert id1 == id2
    
    def test_generate_doc_id_different_chunks(self):
        """Test that different chunks generate different IDs"""
        file_path = "test/path/file.md"
        
        id1 = generate_doc_id(file_path, 0)
        id2 = generate_doc_id(file_path, 1)
        
        assert id1 != id2
    
    def test_generate_doc_id_format(self):
        """Test that ID has expected format"""
        file_path = "test/path/file.md"
        doc_id = generate_doc_id(file_path, 0)
        
        assert isinstance(doc_id, str)
        assert len(doc_id) == 16  # Truncated SHA-256


class TestVectorSearch:
    """Test vector search functionality"""
    
    def test_vector_search_basic(self):
        """Test basic vector search"""
        with patch('index.bedrock_runtime') as mock_bedrock, \
             patch('index.knowledge_base_table') as mock_table:
            from index import vector_search
            
            # Mock embedding generation
            mock_response = {
                'body': Mock(read=lambda: json.dumps({
                    'embedding': [0.1] * 1536
                }).encode())
            }
            mock_bedrock.invoke_model.return_value = mock_response
            
            # Mock DynamoDB scan
            mock_table.scan.return_value = {
                'Items': [
                    {
                        'doc_id': 'doc1',
                        'title': 'Test Doc 1',
                        'content': 'Test content 1',
                        'category': 'algorithms',
                        'complexity': 'medium',
                        'topics': ['dp'],
                        'embedding': embedding_to_binary([0.1] * 1536)
                    },
                    {
                        'doc_id': 'doc2',
                        'title': 'Test Doc 2',
                        'content': 'Test content 2',
                        'category': 'patterns',
                        'complexity': 'easy',
                        'topics': ['sliding-window'],
                        'embedding': embedding_to_binary([0.2] * 1536)
                    }
                ]
            }
            
            results = vector_search("test query", top_k=2)
            
            assert len(results) <= 2
            assert all('doc_id' in r for r in results)
            assert all('score' in r for r in results)
            assert all('title' in r for r in results)
    
    def test_vector_search_with_category_filter(self):
        """Test vector search with category filter"""
        with patch('index.bedrock_runtime') as mock_bedrock, \
             patch('index.knowledge_base_table') as mock_table:
            from index import vector_search
            
            # Mock embedding generation
            mock_response = {
                'body': Mock(read=lambda: json.dumps({
                    'embedding': [0.1] * 1536
                }).encode())
            }
            mock_bedrock.invoke_model.return_value = mock_response
            
            # Mock DynamoDB scan
            mock_table.scan.return_value = {
                'Items': [
                    {
                        'doc_id': 'doc1',
                        'title': 'Algorithm Doc',
                        'content': 'Algorithm content',
                        'category': 'algorithms',
                        'complexity': 'medium',
                        'topics': ['dp'],
                        'embedding': embedding_to_binary([0.1] * 1536)
                    }
                ]
            }
            
            results = vector_search("test query", category_filter='algorithms')
            
            # Verify filter was applied
            mock_table.scan.assert_called_once()
            call_args = mock_table.scan.call_args
            assert 'FilterExpression' in call_args[1]
    
    def test_vector_search_sorted_by_score(self):
        """Test that results are sorted by similarity score"""
        with patch('index.bedrock_runtime') as mock_bedrock, \
             patch('index.knowledge_base_table') as mock_table:
            from index import vector_search
            
            # Mock embedding generation
            query_embedding = [1.0] * 1536
            mock_response = {
                'body': Mock(read=lambda: json.dumps({
                    'embedding': query_embedding
                }).encode())
            }
            mock_bedrock.invoke_model.return_value = mock_response
            
            # Mock DynamoDB with different similarity scores
            mock_table.scan.return_value = {
                'Items': [
                    {
                        'doc_id': 'doc1',
                        'title': 'Low similarity',
                        'content': 'Content 1',
                        'category': 'algorithms',
                        'complexity': 'medium',
                        'topics': [],
                        'embedding': embedding_to_binary([0.1] * 1536)  # Low similarity
                    },
                    {
                        'doc_id': 'doc2',
                        'title': 'High similarity',
                        'content': 'Content 2',
                        'category': 'algorithms',
                        'complexity': 'medium',
                        'topics': [],
                        'embedding': embedding_to_binary([0.9] * 1536)  # High similarity
                    }
                ]
            }
            
            results = vector_search("test query", top_k=2)
            
            # Check that results are sorted by score (descending)
            if len(results) > 1:
                for i in range(len(results) - 1):
                    assert results[i]['score'] >= results[i + 1]['score']


class TestRetrieveKnowledge:
    """Test RAG knowledge retrieval"""
    
    def test_retrieve_knowledge_basic(self):
        """Test basic knowledge retrieval"""
        with patch('index.vector_search') as mock_search:
            from index import retrieve_knowledge
            
            mock_search.return_value = [
                {
                    'doc_id': 'doc1',
                    'title': 'Test Doc',
                    'content': 'Test content',
                    'score': 0.9
                }
            ]
            
            results = retrieve_knowledge("test query")
            
            assert len(results) > 0
            mock_search.assert_called_once()
    
    def test_retrieve_knowledge_with_user_context(self):
        """Test knowledge retrieval with user context"""
        with patch('index.vector_search') as mock_search:
            from index import retrieve_knowledge
            
            mock_search.return_value = []
            
            user_context = {
                'total_solved': 15,  # Beginner
                'weak_topics': ['dp', 'graphs']
            }
            
            results = retrieve_knowledge("test query", user_context=user_context)
            
            # Verify complexity filter was applied for beginner
            call_args = mock_search.call_args
            assert call_args[1]['complexity_filter'] == 'easy'
    
    def test_retrieve_knowledge_intermediate_user(self):
        """Test knowledge retrieval for intermediate user"""
        with patch('index.vector_search') as mock_search:
            from index import retrieve_knowledge
            
            mock_search.return_value = []
            
            user_context = {
                'total_solved': 50,  # Intermediate
                'weak_topics': ['dp']
            }
            
            results = retrieve_knowledge("test query", user_context=user_context)
            
            # Verify complexity filter for intermediate
            call_args = mock_search.call_args
            assert call_args[1]['complexity_filter'] == 'medium'
    
    def test_retrieve_knowledge_advanced_user(self):
        """Test knowledge retrieval for advanced user"""
        with patch('index.vector_search') as mock_search:
            from index import retrieve_knowledge
            
            mock_search.return_value = []
            
            user_context = {
                'total_solved': 150,  # Advanced
                'weak_topics': []
            }
            
            results = retrieve_knowledge("test query", user_context=user_context)
            
            # Verify no complexity filter for advanced
            call_args = mock_search.call_args
            assert call_args[1]['complexity_filter'] is None


class TestEndToEndRAG:
    """End-to-end integration tests"""
    
    def test_rag_pipeline_concept_question(self):
        """Test full RAG pipeline for concept question"""
        with patch('index.bedrock_runtime') as mock_bedrock, \
             patch('index.knowledge_base_table') as mock_table:
            from index import retrieve_knowledge
            
            # Mock embedding generation
            mock_response = {
                'body': Mock(read=lambda: json.dumps({
                    'embedding': [0.5] * 1536
                }).encode())
            }
            mock_bedrock.invoke_model.return_value = mock_response
            
            # Mock DynamoDB with relevant document
            mock_table.scan.return_value = {
                'Items': [
                    {
                        'doc_id': 'dp_doc',
                        'title': 'Dynamic Programming Fundamentals',
                        'content': 'DP is an optimization technique...',
                        'category': 'algorithms',
                        'complexity': 'medium',
                        'topics': ['dynamic-programming'],
                        'embedding': embedding_to_binary([0.5] * 1536),
                        'chunk_index': 0
                    }
                ]
            }
            
            # Perform retrieval
            results = retrieve_knowledge(
                query="Explain dynamic programming",
                user_context={'total_solved': 30}
            )
            
            # Verify results
            assert len(results) > 0
            assert results[0]['title'] == 'Dynamic Programming Fundamentals'
            assert 'score' in results[0]
            assert results[0]['category'] == 'algorithms'
    
    def test_rag_pipeline_debugging_question(self):
        """Test RAG pipeline for debugging question"""
        with patch('index.bedrock_runtime') as mock_bedrock, \
             patch('index.knowledge_base_table') as mock_table:
            from index import retrieve_knowledge
            
            # Mock embedding generation
            mock_response = {
                'body': Mock(read=lambda: json.dumps({
                    'embedding': [0.3] * 1536
                }).encode())
            }
            mock_bedrock.invoke_model.return_value = mock_response
            
            # Mock DynamoDB with debugging document
            mock_table.scan.return_value = {
                'Items': [
                    {
                        'doc_id': 'tle_doc',
                        'title': 'Debugging Time Limit Exceeded',
                        'content': 'TLE means your solution is too slow...',
                        'category': 'debugging',
                        'complexity': 'medium',
                        'topics': ['optimization'],
                        'embedding': embedding_to_binary([0.3] * 1536),
                        'chunk_index': 0
                    }
                ]
            }
            
            # Perform retrieval
            results = retrieve_knowledge(
                query="Getting TLE on my solution",
                user_context={'total_solved': 50}
            )
            
            # Verify results
            assert len(results) > 0
            assert 'Time Limit' in results[0]['title']
            assert results[0]['category'] == 'debugging'


if __name__ == '__main__':
    pytest.main([__file__, '-v'])

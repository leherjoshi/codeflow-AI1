"""
RAG (Retrieval-Augmented Generation) Implementation
Budget-optimized with DynamoDB vector storage (replaces OpenSearch)

Cost Savings: $200/month by using DynamoDB + in-memory similarity instead of OpenSearch
"""

import json
import os
import hashlib
import struct
from typing import List, Dict, Any, Optional, Tuple
from datetime import datetime, timezone
import boto3
import numpy as np

# Initialize AWS clients
dynamodb = boto3.resource('dynamodb')
bedrock_runtime = boto3.client('bedrock-runtime')
s3 = boto3.client('s3')

# DynamoDB tables
knowledge_base_table = dynamodb.Table(os.environ.get('KNOWLEDGE_BASE_TABLE', 'KnowledgeBase'))

# Constants
EMBEDDING_MODEL = 'cohere.embed-english-v3'
EMBEDDING_DIMENSIONS = 1024  # Cohere Embed English v3 uses 1024 dimensions
CHUNK_SIZE = 500  # tokens per chunk
CHUNK_OVERLAP = 50  # token overlap between chunks
TOP_K_RESULTS = 5  # number of results to return
def generate_embeddings_for_knowledge_base(
    documents_path: str = 'lambda-functions/rag/knowledge_base'
) -> Dict[str, Any]:
    """
    Generate embeddings for all knowledge base documents and store in DynamoDB
    
    This replaces the OpenSearch indexing pipeline with a DynamoDB-based approach.
    
    Process:
    1. Read markdown files from local directory (or S3 in production)
    2. Parse frontmatter and content
    3. Chunk content (500 tokens, 50 overlap)
    4. Generate embeddings with Titan
    5. Store in DynamoDB with binary embedding attribute
    
    Args:
        documents_path: Path to knowledge base documents
    
    Returns:
        Dictionary with processing stats
    """
    import glob
    
    stats = {
        'documents_processed': 0,
        'chunks_created': 0,
        'embeddings_generated': 0,
        'errors': []
    }
    
    try:
        # Find all markdown files
        pattern = f"{documents_path}/**/*.md"
        markdown_files = glob.glob(pattern, recursive=True)
        
        print(f"Found {len(markdown_files)} markdown files")
        
        for file_path in markdown_files:
            try:
                # Read and parse document
                with open(file_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                
                # Parse frontmatter and content
                metadata, text = parse_markdown_with_frontmatter(content)
                
                # Extract category from file path
                if '/algorithms/' in file_path:
                    category = 'algorithms'
                elif '/patterns/' in file_path:
                    category = 'patterns'
                elif '/debugging/' in file_path:
                    category = 'debugging'
                else:
                    category = 'general'
                
                metadata['category'] = category
                
                # Chunk content
                chunks = chunk_text(text, CHUNK_SIZE, CHUNK_OVERLAP)
                
                print(f"Processing {file_path}: {len(chunks)} chunks")
                
                # Generate embeddings for each chunk
                for i, chunk in enumerate(chunks):
                    try:
                        # Generate embedding
                        embedding = generate_embedding(chunk)
                        
                        # Create document ID
                        doc_id = generate_doc_id(file_path, i)
                        
                        # Store in DynamoDB
                        store_embedding_in_dynamodb(
                            doc_id=doc_id,
                            title=metadata.get('title', 'Untitled'),
                            content=chunk,
                            embedding=embedding,
                            category=category,
                            complexity=metadata.get('complexity', 'medium'),
                            topics=metadata.get('topics', []),
                            chunk_index=i,
                            total_chunks=len(chunks)
                        )
                        
                        stats['chunks_created'] += 1
                        stats['embeddings_generated'] += 1
                    
                    except Exception as e:
                        error_msg = f"Error processing chunk {i} of {file_path}: {str(e)}"
                        print(error_msg)
                        stats['errors'].append(error_msg)
                
                stats['documents_processed'] += 1
            
            except Exception as e:
                error_msg = f"Error processing {file_path}: {str(e)}"
                print(error_msg)
                stats['errors'].append(error_msg)
        
        print(f"Embedding generation complete: {stats}")
        return stats
    
    except Exception as e:
        print(f"Error in generate_embeddings_for_knowledge_base: {str(e)}")
        raise
def parse_markdown_with_frontmatter(content: str) -> Tuple[Dict[str, Any], str]:
    """
    Parse markdown file with YAML frontmatter
    
    Args:
        content: Markdown file content
    
    Returns:
        Tuple of (metadata dict, content text)
    """
    lines = content.split('\n')
    
    # Check for frontmatter
    if lines[0].strip() == '---':
        # Find end of frontmatter
        end_index = -1
        for i in range(1, len(lines)):
            if lines[i].strip() == '---':
                end_index = i
                break
        
        if end_index > 0:
            # Parse frontmatter (simple key: value parsing)
            metadata = {}
            for line in lines[1:end_index]:
                if ':' in line:
                    key, value = line.split(':', 1)
                    key = key.strip()
                    value = value.strip()
                    
                    # Handle lists [item1, item2]
                    if value.startswith('[') and value.endswith(']'):
                        value = [item.strip() for item in value[1:-1].split(',')]
                    
                    metadata[key] = value
            
            # Content is everything after frontmatter
            text = '\n'.join(lines[end_index + 1:]).strip()
            return metadata, text
    
    # No frontmatter
    return {}, content
def chunk_text(text: str, chunk_size: int, overlap: int) -> List[str]:
    """
    Chunk text into overlapping segments
    
    Simple word-based chunking (not token-based for simplicity)
    
    Args:
        text: Text to chunk
        chunk_size: Approximate words per chunk
        overlap: Approximate words to overlap
    
    Returns:
        List of text chunks
    """
    words = text.split()
    chunks = []
    
    i = 0
    while i < len(words):
        # Get chunk
        chunk_words = words[i:i + chunk_size]
        chunk = ' '.join(chunk_words)
        chunks.append(chunk)
        
        # Move forward (with overlap)
        i += chunk_size - overlap
        
        # Avoid infinite loop
        if i <= len(chunks) * overlap:
            i = len(chunks) * chunk_size
    
    return chunks
def generate_embedding(text: str) -> List[float]:
    """
    Generate embedding using Cohere Embed English v3
    
    Args:
        text: Text to embed
    
    Returns:
        Embedding vector (1024 dimensions)
    """
    try:
        # Prepare request for Cohere
        request_body = {
            "texts": [text],
            "input_type": "search_document",  # For indexing documents
            "truncate": "END"
        }
        
        # Invoke Bedrock
        response = bedrock_runtime.invoke_model(
            modelId=EMBEDDING_MODEL,
            body=json.dumps(request_body)
        )
        
        # Parse response
        response_body = json.loads(response['body'].read())
        embeddings = response_body.get('embeddings', [])
        
        if not embeddings or len(embeddings) == 0:
            raise ValueError("No embeddings returned")
        
        embedding = embeddings[0]  # Get first embedding
        
        if len(embedding) != EMBEDDING_DIMENSIONS:
            raise ValueError(f"Expected {EMBEDDING_DIMENSIONS} dimensions, got {len(embedding)}")
        
        return embedding
    
    except Exception as e:
        print(f"Error generating embedding: {str(e)}")
        raise
def store_embedding_in_dynamodb(
    doc_id: str,
    title: str,
    content: str,
    embedding: List[float],
    category: str,
    complexity: str,
    topics: List[str],
    chunk_index: int,
    total_chunks: int
):
    """
    Store document with embedding in DynamoDB
    
    Embedding is stored as binary data to save space.
    
    Args:
        doc_id: Unique document ID
        title: Document title
        content: Chunk content
        embedding: Embedding vector
        category: Category (algorithms, patterns, debugging)
        complexity: Complexity level (easy, medium, hard)
        topics: List of topics
        chunk_index: Chunk index
        total_chunks: Total number of chunks
    """
    try:
        # Convert embedding to binary (more space-efficient than JSON array)
        embedding_binary = embedding_to_binary(embedding)
        
        # Store in DynamoDB
        knowledge_base_table.put_item(
            Item={
                'doc_id': doc_id,
                'title': title,
                'content': content,
                'embedding': embedding_binary,  # Binary attribute
                'category': category,
                'complexity': complexity,
                'topics': topics,
                'chunk_index': chunk_index,
                'total_chunks': total_chunks,
                'created_at': datetime.now(timezone.utc).isoformat()
            }
        )
        
        print(f"Stored document {doc_id} in DynamoDB")
    
    except Exception as e:
        print(f"Error storing in DynamoDB: {str(e)}")
        raise
def embedding_to_binary(embedding: List[float]) -> bytes:
    """
    Convert embedding vector to binary format
    
    Uses struct to pack floats into bytes (4 bytes per float)
    
    Args:
        embedding: List of floats
    
    Returns:
        Binary data
    """
    # Pack as array of floats (4 bytes each)
    return struct.pack(f'{len(embedding)}f', *embedding)
def binary_to_embedding(binary_data: bytes) -> List[float]:
    """
    Convert binary data back to embedding vector
    
    Args:
        binary_data: Binary data
    
    Returns:
        List of floats
    """
    # Unpack binary data
    num_floats = len(binary_data) // 4
    return list(struct.unpack(f'{num_floats}f', binary_data))
def generate_doc_id(file_path: str, chunk_index: int) -> str:
    """
    Generate unique document ID
    
    Args:
        file_path: File path
        chunk_index: Chunk index
    
    Returns:
        Document ID
    """
    # Use hash of file path + chunk index
    hash_input = f"{file_path}#{chunk_index}"
    return hashlib.sha256(hash_input.encode()).hexdigest()[:16]
def vector_search(
    query: str,
    top_k: int = TOP_K_RESULTS,
    category_filter: Optional[str] = None,
    complexity_filter: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    Perform vector similarity search using DynamoDB + in-memory calculation
    
    Budget-optimized approach:
    1. Generate query embedding
    2. Scan DynamoDB table (or use GSI for category filter)
    3. Calculate cosine similarity in-memory
    4. Return top-k results
    
    Trade-off: Slower than OpenSearch, but saves $200/month
    For small knowledge bases (<1000 documents), this is acceptable.
    
    Args:
        query: Search query
        top_k: Number of results to return
        category_filter: Optional category filter
        complexity_filter: Optional complexity filter
    
    Returns:
        List of matching documents with scores
    """
    try:
        # Generate query embedding
        query_embedding = generate_embedding(query)
        
        # Scan DynamoDB (with optional filters)
        scan_params = {}
        
        if category_filter:
            scan_params['FilterExpression'] = 'category = :category'
            scan_params['ExpressionAttributeValues'] = {':category': category_filter}
        
        response = knowledge_base_table.scan(**scan_params)
        items = response.get('Items', [])
        
        # Calculate similarity scores
        results = []
        for item in items:
            # Convert binary embedding back to vector
            embedding_binary = item.get('embedding')
            if not embedding_binary:
                continue
            
            doc_embedding = binary_to_embedding(embedding_binary)
            
            # Calculate cosine similarity
            similarity = cosine_similarity(query_embedding, doc_embedding)
            
            # Apply complexity filter if specified
            if complexity_filter and item.get('complexity') != complexity_filter:
                continue
            
            results.append({
                'doc_id': item.get('doc_id'),
                'title': item.get('title'),
                'content': item.get('content'),
                'category': item.get('category'),
                'complexity': item.get('complexity'),
                'topics': item.get('topics', []),
                'score': similarity,
                'chunk_index': item.get('chunk_index', 0)
            })
        
        # Sort by similarity score (descending)
        results.sort(key=lambda x: x['score'], reverse=True)
        
        # Return top-k
        return results[:top_k]
    
    except Exception as e:
        print(f"Error in vector_search: {str(e)}")
        raise
def cosine_similarity(vec1: List[float], vec2: List[float]) -> float:
    """
    Calculate cosine similarity between two vectors
    
    Formula: cos(θ) = (A · B) / (||A|| * ||B||)
    
    Args:
        vec1: First vector
        vec2: Second vector
    
    Returns:
        Similarity score (0 to 1)
    """
    # Convert to numpy arrays for efficient calculation
    a = np.array(vec1)
    b = np.array(vec2)
    
    # Calculate dot product
    dot_product = np.dot(a, b)
    
    # Calculate magnitudes
    magnitude_a = np.linalg.norm(a)
    magnitude_b = np.linalg.norm(b)
    
    # Avoid division by zero
    if magnitude_a == 0 or magnitude_b == 0:
        return 0.0
    
    # Calculate cosine similarity
    similarity = dot_product / (magnitude_a * magnitude_b)
    
    return float(similarity)
def retrieve_knowledge(
    query: str,
    user_context: Optional[Dict[str, Any]] = None,
    top_k: int = TOP_K_RESULTS
) -> List[Dict[str, Any]]:
    """
    Retrieve relevant knowledge for RAG
    
    This is the main entry point for RAG retrieval.
    
    Args:
        query: User query
        user_context: Optional user context (weak topics, proficiency level)
        top_k: Number of results to return
    
    Returns:
        List of relevant knowledge chunks with metadata
    """
    try:
        # Determine category filter based on query
        category_filter = detect_category_from_query(query)
        
        # Determine complexity filter based on user context
        complexity_filter = None
        if user_context:
            total_solved = user_context.get('total_solved', 0)
            if total_solved < 20:
                complexity_filter = 'easy'
            elif total_solved < 100:
                complexity_filter = 'medium'
            # else: no filter (show all)
        
        # Perform vector search
        results = vector_search(
            query=query,
            top_k=top_k,
            category_filter=category_filter,
            complexity_filter=complexity_filter
        )
        
        return results
    
    except Exception as e:
        print(f"Error in retrieve_knowledge: {str(e)}")
        return []
def detect_category_from_query(query: str) -> Optional[str]:
    """
    Detect category from query using keyword matching
    
    Args:
        query: User query
    
    Returns:
        Category or None
    """
    query_lower = query.lower()
    
    # Algorithm keywords
    if any(word in query_lower for word in ['dynamic programming', 'dp', 'graph', 'tree', 'bfs', 'dfs', 'dijkstra']):
        return 'algorithms'
    
    # Pattern keywords
    if any(word in query_lower for word in ['sliding window', 'two pointer', 'pattern', 'approach']):
        return 'patterns'
    
    # Debugging keywords
    if any(word in query_lower for word in ['tle', 'time limit', 'wrong', 'debug', 'error', 'fix']):
        return 'debugging'
    
    return None


# Lambda handler for testing
def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Lambda handler for RAG operations
    
    Supported operations:
    - POST /rag/generate-embeddings: Generate embeddings for knowledge base
    - POST /rag/search: Perform vector search
    - POST /rag/retrieve: Retrieve knowledge for RAG
    """
    try:
        http_method = event.get('httpMethod', '')
        path = event.get('path', '')
        body = json.loads(event.get('body', '{}')) if event.get('body') else {}
        
        if http_method == 'POST' and '/generate-embeddings' in path:
            # Generate embeddings (admin operation)
            stats = generate_embeddings_for_knowledge_base()
            return {
                'statusCode': 200,
                'body': json.dumps(stats)
            }
        
        elif http_method == 'POST' and '/search' in path:
            # Vector search
            query = body.get('query')
            top_k = body.get('top_k', TOP_K_RESULTS)
            
            results = vector_search(query, top_k)
            
            return {
                'statusCode': 200,
                'body': json.dumps({
                    'query': query,
                    'results': results,
                    'count': len(results)
                })
            }
        
        elif http_method == 'POST' and '/retrieve' in path:
            # RAG retrieval
            query = body.get('query')
            user_context = body.get('user_context')
            
            results = retrieve_knowledge(query, user_context)
            
            return {
                'statusCode': 200,
                'body': json.dumps({
                    'query': query,
                    'results': results,
                    'count': len(results)
                })
            }
        
        else:
            return {
                'statusCode': 404,
                'body': json.dumps({'error': 'Not found'})
            }
    
    except Exception as e:
        print(f"Error in RAG handler: {str(e)}")
        return {
            'statusCode': 500,
            'body': json.dumps({'error': str(e)})
        }

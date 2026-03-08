#!/usr/bin/env python3
"""
Upload Knowledge Base Documents to S3

This script uploads all knowledge base documents to the S3 bucket
for backup and versioning purposes.

Usage:
    python3 upload_to_s3.py [--bucket BUCKET_NAME] [--dry-run]

Options:
    --bucket    S3 bucket name (default: auto-detect from CloudFormation)
    --dry-run   Show what would be uploaded without actually uploading
"""

import os
import sys
import argparse
import glob
import boto3
from datetime import datetime
from pathlib import Path


def get_bucket_name_from_cfn(stack_name='CodeFlowInfrastructureStack'):
    """
    Get S3 bucket name from CloudFormation stack outputs
    
    Args:
        stack_name: CloudFormation stack name
        
    Returns:
        Bucket name or None if not found
    """
    try:
        cfn = boto3.client('cloudformation')
        response = cfn.describe_stacks(StackName=stack_name)
        
        if not response.get('Stacks'):
            return None
        
        outputs = response['Stacks'][0].get('Outputs', [])
        
        for output in outputs:
            if output['OutputKey'] == 'KBDocumentsBucketName':
                return output['OutputValue']
        
        return None
    
    except Exception as e:
        print(f"⚠️  Could not get bucket name from CloudFormation: {str(e)}")
        return None


def discover_documents(base_path='knowledge_base'):
    """
    Discover all markdown documents in knowledge base
    
    Args:
        base_path: Base directory for knowledge base
        
    Returns:
        List of (local_path, s3_key) tuples
    """
    documents = []
    
    pattern = f"{base_path}/**/*.md"
    markdown_files = glob.glob(pattern, recursive=True)
    
    for file_path in markdown_files:
        # Convert local path to S3 key
        # e.g., knowledge_base/algorithms/graphs.md -> algorithms/graphs.md
        relative_path = os.path.relpath(file_path, base_path)
        s3_key = relative_path.replace('\\', '/')  # Windows compatibility
        
        documents.append((file_path, s3_key))
    
    return documents


def upload_document(s3_client, bucket_name, local_path, s3_key, dry_run=False):
    """
    Upload a single document to S3
    
    Args:
        s3_client: Boto3 S3 client
        bucket_name: S3 bucket name
        local_path: Local file path
        s3_key: S3 object key
        dry_run: If True, don't actually upload
        
    Returns:
        True if successful, False otherwise
    """
    try:
        # Get file size
        file_size = os.path.getsize(local_path)
        
        if dry_run:
            print(f"  [DRY RUN] Would upload: {local_path} -> s3://{bucket_name}/{s3_key} ({file_size} bytes)")
            return True
        
        # Read file content
        with open(local_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Upload to S3
        s3_client.put_object(
            Bucket=bucket_name,
            Key=s3_key,
            Body=content.encode('utf-8'),
            ContentType='text/markdown',
            Metadata={
                'uploaded_at': datetime.utcnow().isoformat(),
                'source': 'knowledge_base_seeding'
            }
        )
        
        print(f"  ✅ Uploaded: {s3_key} ({file_size} bytes)")
        return True
    
    except Exception as e:
        print(f"  ❌ Failed to upload {local_path}: {str(e)}")
        return False


def verify_uploads(s3_client, bucket_name, expected_keys):
    """
    Verify all documents were uploaded successfully
    
    Args:
        s3_client: Boto3 S3 client
        bucket_name: S3 bucket name
        expected_keys: List of expected S3 keys
        
    Returns:
        True if all documents exist, False otherwise
    """
    print()
    print("Verifying uploads...")
    print("-" * 80)
    
    all_exist = True
    
    for s3_key in expected_keys:
        try:
            response = s3_client.head_object(
                Bucket=bucket_name,
                Key=s3_key
            )
            
            size = response['ContentLength']
            last_modified = response['LastModified']
            
            print(f"  ✅ {s3_key} ({size} bytes, modified: {last_modified})")
        
        except s3_client.exceptions.NoSuchKey:
            print(f"  ❌ {s3_key} - NOT FOUND")
            all_exist = False
        
        except Exception as e:
            print(f"  ⚠️  {s3_key} - Error: {str(e)}")
            all_exist = False
    
    return all_exist


def list_s3_contents(s3_client, bucket_name):
    """
    List all objects in S3 bucket
    
    Args:
        s3_client: Boto3 S3 client
        bucket_name: S3 bucket name
    """
    print()
    print("S3 Bucket Contents:")
    print("-" * 80)
    
    try:
        paginator = s3_client.get_paginator('list_objects_v2')
        pages = paginator.paginate(Bucket=bucket_name)
        
        total_size = 0
        total_count = 0
        
        for page in pages:
            for obj in page.get('Contents', []):
                key = obj['Key']
                size = obj['Size']
                last_modified = obj['LastModified']
                
                total_size += size
                total_count += 1
                
                print(f"  {key}")
                print(f"    Size: {size} bytes")
                print(f"    Modified: {last_modified}")
                print()
        
        print(f"Total: {total_count} objects, {total_size} bytes ({total_size / 1024:.2f} KB)")
    
    except Exception as e:
        print(f"❌ Error listing bucket contents: {str(e)}")


def main():
    """
    Main entry point
    """
    parser = argparse.ArgumentParser(
        description='Upload knowledge base documents to S3'
    )
    parser.add_argument(
        '--bucket',
        help='S3 bucket name (default: auto-detect from CloudFormation)'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Show what would be uploaded without actually uploading'
    )
    parser.add_argument(
        '--verify-only',
        action='store_true',
        help='Only verify existing uploads, do not upload'
    )
    parser.add_argument(
        '--list',
        action='store_true',
        help='List all objects in S3 bucket'
    )
    
    args = parser.parse_args()
    
    print("=" * 80)
    print("CodeFlow AI - Knowledge Base S3 Upload")
    print("=" * 80)
    print()
    
    # Get bucket name
    bucket_name = args.bucket
    
    if not bucket_name:
        print("Auto-detecting S3 bucket from CloudFormation...")
        bucket_name = get_bucket_name_from_cfn()
        
        if not bucket_name:
            print()
            print("❌ Could not auto-detect bucket name.")
            print()
            print("Please specify bucket name manually:")
            print("  python3 upload_to_s3.py --bucket codeflow-kb-documents-prod-123456789")
            print()
            return 1
    
    print(f"S3 Bucket: {bucket_name}")
    print()
    
    # Create S3 client
    s3_client = boto3.client('s3')
    
    # Verify bucket exists
    try:
        s3_client.head_bucket(Bucket=bucket_name)
        print("✅ S3 bucket exists and is accessible")
        print()
    except Exception as e:
        print(f"❌ Cannot access S3 bucket: {str(e)}")
        print()
        return 1
    
    # List bucket contents if requested
    if args.list:
        list_s3_contents(s3_client, bucket_name)
        return 0
    
    # Discover documents
    print("Discovering documents...")
    print("-" * 80)
    
    documents = discover_documents()
    
    if not documents:
        print("❌ No documents found in knowledge_base directory")
        print()
        return 1
    
    print(f"Found {len(documents)} documents:")
    for local_path, s3_key in documents:
        file_size = os.path.getsize(local_path)
        print(f"  - {s3_key} ({file_size} bytes)")
    
    print()
    
    # Verify only mode
    if args.verify_only:
        expected_keys = [s3_key for _, s3_key in documents]
        all_exist = verify_uploads(s3_client, bucket_name, expected_keys)
        
        print()
        if all_exist:
            print("✅ All documents verified in S3")
            return 0
        else:
            print("⚠️  Some documents are missing from S3")
            return 1
    
    # Upload documents
    if args.dry_run:
        print("🔍 DRY RUN MODE - No actual uploads will be performed")
        print()
    
    print("Uploading documents...")
    print("-" * 80)
    
    success_count = 0
    fail_count = 0
    
    for local_path, s3_key in documents:
        if upload_document(s3_client, bucket_name, local_path, s3_key, args.dry_run):
            success_count += 1
        else:
            fail_count += 1
    
    print()
    print("=" * 80)
    print("Upload Summary")
    print("=" * 80)
    print()
    print(f"✅ Successful: {success_count}")
    print(f"❌ Failed: {fail_count}")
    print()
    
    if args.dry_run:
        print("🔍 This was a dry run. No files were actually uploaded.")
        print("   Run without --dry-run to perform actual upload.")
        print()
        return 0
    
    # Verify uploads
    if success_count > 0 and fail_count == 0:
        expected_keys = [s3_key for _, s3_key in documents]
        all_exist = verify_uploads(s3_client, bucket_name, expected_keys)
        
        print()
        if all_exist:
            print("🎉 All documents uploaded and verified successfully!")
            print()
            print("Next steps:")
            print("  1. Run seeding script: python3 seed_knowledge_base.py")
            print("  2. Verify DynamoDB: aws dynamodb scan --table-name KnowledgeBase --select COUNT")
            print("  3. Test RAG retrieval: python3 test_rag.py")
            print()
            return 0
        else:
            print("⚠️  Some documents could not be verified")
            print()
            return 1
    else:
        print("⚠️  Some uploads failed. Please check errors above.")
        print()
        return 1


if __name__ == '__main__':
    sys.exit(main())

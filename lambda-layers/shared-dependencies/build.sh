#!/bin/bash

# Build script for Lambda layer
# This script creates a Lambda layer package with all dependencies

set -e

echo "Building Lambda layer: shared-dependencies"

# Clean previous build
rm -rf python/
rm -f layer.zip

# Create python directory
mkdir -p python

# Install dependencies
echo "Installing dependencies..."
pip install -r python/requirements.txt -t python/ --upgrade

# Remove unnecessary files to reduce layer size
echo "Cleaning up unnecessary files..."
cd python
find . -type d -name "tests" -exec rm -rf {} + 2>/dev/null || true
find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
find . -type f -name "*.pyc" -delete
find . -type f -name "*.pyo" -delete
find . -type f -name "*.dist-info" -exec rm -rf {} + 2>/dev/null || true
cd ..

# Create zip file
echo "Creating layer.zip..."
zip -r layer.zip python/ -q

# Get size
SIZE=$(du -h layer.zip | cut -f1)
echo "Layer size: $SIZE"

# Check if size is under 50MB (unzipped limit is 250MB)
UNZIPPED_SIZE=$(unzip -l layer.zip | tail -1 | awk '{print $1}')
UNZIPPED_MB=$((UNZIPPED_SIZE / 1024 / 1024))

if [ $UNZIPPED_MB -gt 250 ]; then
    echo "WARNING: Unzipped layer size ($UNZIPPED_MB MB) exceeds 250MB limit!"
    exit 1
fi

echo "Build complete! Layer is ready for deployment."
echo "Unzipped size: ${UNZIPPED_MB}MB"

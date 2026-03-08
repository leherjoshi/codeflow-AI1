#!/bin/bash

# Build Lambda layer with Docker to ensure compatibility with Lambda runtime

echo "Building Lambda layer with Docker..."

# Clean up old build
rm -rf python/
mkdir -p python

# Build using Docker with Python 3.11 (Lambda runtime)
docker run --rm \
  -v "$PWD":/var/task \
  -w /var/task \
  public.ecr.aws/lambda/python:3.11 \
  pip install -r python/requirements.txt -t python/python/ --no-cache-dir

echo "Layer built successfully!"
echo "Contents:"
ls -la python/python/ | head -20

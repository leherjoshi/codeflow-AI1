# Shared Dependencies Lambda Layer

This Lambda layer contains shared dependencies used across all CodeFlow AI Lambda functions.

## Dependencies

- **boto3**: AWS SDK for Python
- **pydantic**: Data validation and serialization
- **httpx**: Modern HTTP client for Python
- **orjson**: Fast JSON serialization
- **PyJWT**: JWT token handling
- **aws-xray-sdk**: AWS X-Ray tracing

## Building the Layer

To build this layer locally:

```bash
cd lambda-layers/shared-dependencies
mkdir -p python
pip install -r python/requirements.txt -t python/
zip -r layer.zip python/
```

## Deployment

The layer is automatically built and deployed by AWS CDK during stack deployment.

## Usage in Lambda Functions

Lambda functions using this layer can import dependencies directly:

```python
import boto3
from pydantic import BaseModel
import httpx
import orjson
import jwt
from aws_xray_sdk.core import xray_recorder
```

## Layer Structure

```
lambda-layers/shared-dependencies/
├── python/
│   ├── requirements.txt
│   ├── boto3/
│   ├── pydantic/
│   ├── httpx/
│   ├── orjson/
│   ├── jwt/
│   └── aws_xray_sdk/
└── README.md
```

## Notes

- The layer is compatible with Python 3.11 runtime
- Maximum layer size: 50 MB (unzipped)
- Layers are versioned and immutable
- Update the layer version when dependencies change

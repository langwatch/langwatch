# Datasets API

This directory contains the new Hono-based Datasets API that follows the service-repository pattern.

## Structure

```text
datasets/
├── [[...route]]/
│   ├── app.ts              # Main Hono app with middleware
│   ├── app.v1.ts           # V1 API routes
│   ├── route.ts            # Next.js route handlers
│   ├── tools.ts            # AI tools for dataset generation
│   ├── utils.ts            # Utility functions
│   └── schemas/            # Input/output schemas
│       ├── index.ts
│       ├── inputs.ts
│       └── outputs.ts
├── middleware/             # Dataset-specific middleware (if needed)
└── __tests__/              # Test files
```

## API Endpoints

### POST /api/datasets/:slug/entries

Add entries to a dataset.

**Request Body:**
```json
{
  "entries": [
    {
      "input": "hi",
      "output": "Hello, how can I help you today?"
    }
  ]
}
```

**Response:**
```json
{
  "success": true
}
```

### GET /api/datasets/:slugOrId

Get a dataset by its slug or ID.

**Response:**
```json
{
  "id": "dataset-id",
  "name": "Dataset Name",
  "slug": "dataset-slug",
  "projectId": "project-id",
  "columnTypes": [...],
  "createdAt": "2024-01-01T00:00:00Z",
  "updatedAt": "2024-01-01T00:00:00Z"
}
```

### POST /api/datasets/generate

Generate dataset entries using AI.

**Request Body:**
```json
{
  "messages": [
    {
      "role": "user",
      "content": "Generate 10 customer support conversations"
    }
  ],
  "dataset": {
    "id": "dataset-id",
    "name": "Customer Support Dataset",
    "columnTypes": [...]
  },
  "projectId": "project-id"
}
```

**Response:**
Stream of AI-generated dataset entries.

**Notes:**
- Uses API key authentication (X-Auth-Token or Authorization header)
- Uses AI tools to add, update, and delete rows
- Limited to 30 rows per generation request
- Supports both singular (`/api/dataset`) and plural (`/api/datasets`) routes

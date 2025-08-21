# Experiments API

This directory contains the new Hono-based Experiments API that follows the service-repository pattern.

## Structure

```text
experiments/
├── [[...route]]/
│   ├── app.ts              # Main Hono app with middleware
│   ├── app.v1.ts           # V1 API routes
│   ├── route.ts            # Next.js route handlers
│   └── schemas/            # Input/output schemas
│       ├── index.ts
│       ├── inputs.ts
│       └── outputs.ts
└── __tests__/              # Test files
    └── init.test.ts
```

## API Endpoints

### POST /api/experiments/init

Initialize or find an experiment.

**Request Body:**
```json
{
  "experiment_id": "string (optional)",
  "experiment_slug": "string (optional)",
  "experiment_type": "DSPY" | "BATCH_EVALUATION" | "BATCH_EVALUATION_V2",
  "experiment_name": "string (optional)",
  "workflowId": "string (optional)"
}
```

**Response:**
```json
{
  "path": "/project-slug/experiments/experiment-slug",
  "slug": "experiment-slug"
}
```

**Notes:**
- Either `experiment_id` or `experiment_slug` is required
- If `experiment_slug` is provided and no experiment exists, a new one will be created
- If `experiment_id` is provided, the experiment must already exist

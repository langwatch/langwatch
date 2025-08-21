# Evaluations API

This directory contains the new Hono-based Evaluations API that follows the service-repository pattern.

## Structure

```text
evaluations/
├── [[...route]]/
│   ├── app.ts              # Main Hono app with middleware
│   ├── app.v1.ts           # V1 API routes with OpenAPI definitions
│   ├── route.ts            # Next.js route handlers
│   └── schemas/            # Input/output schemas
│       ├── index.ts
│       ├── inputs.ts
│       └── outputs.ts
├── middleware/
│   └── evaluation-service.ts # Service injection middleware
└── __tests__/              # Test files
    └── evaluations.test.ts
```

## API Endpoints

### GET /api/evaluations

Get all available evaluators.

**Response:**
```json
{
  "evaluators": {
    "test/evaluator": {
      "name": "Test Evaluator",
      "description": "A test evaluator",
      "settings": {},
      "settings_json_schema": {}
    }
  }
}
```

### POST /api/evaluations/:evaluator/evaluate

Run evaluation with a specific evaluator.

**Request Body:**
```json
{
  "data": {
    "input": "string",
    "output": "string",
    "contexts": ["string"],
    "expected_output": "string",
    "conversation": [
      {
        "input": "string",
        "output": "string"
      }
    ]
  },
  "as_guardrail": false
}
```

**Response:**
```json
{
  "id": "evaluation-id",
  "status": "success",
  "score": 0.8,
  "passed": true,
  "details": "Evaluation completed successfully"
}
```

### POST /api/evaluations/:evaluator/:subpath/evaluate

Legacy route for evaluation with subpath (maintained for backward compatibility).

- Request Body: Same as `/:evaluator/evaluate`
- Response: Same as `/:evaluator/evaluate`

### POST /api/evaluations/batch/log_results

Log batch evaluation results.

**Request Body:**
```json
{
  "run_id": "string",
  "experiment_id": "string (optional)",
  "experiment_slug": "string (optional)",
  "project_id": "string",
  "evaluator_id": "string",
  "name": "string (optional)",
  "workflow_id": "string (optional)",
  "results": [
    {
      "score": 0.8,
      "passed": true
    }
  ],
  "timestamps": {
    "created_at": 1234567890,
    "inserted_at": 1234567890,
    "updated_at": 1234567890
  }
}
```

**Response:**
```json
{
  "message": "ok"
}
```

**Notes:**
- Either `experiment_id` or `experiment_slug` is required
- If `experiment_slug` is provided and no experiment exists, a new one will be created
- Timestamps are automatically converted from Unix timestamps to ISO strings

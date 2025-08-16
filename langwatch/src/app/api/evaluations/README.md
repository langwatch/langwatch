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

## Architecture

The API follows the same pattern as the Prompts API:

1. **Service Layer** (`~/server/evaluations/`): Business logic
   - `evaluation.service.ts`: Core evaluation logic
   - `batch-evaluation.service.ts`: Batch evaluation logic
2. **Repository Layer** (`~/server/evaluations/repositories/`): Data access
   - `evaluation.repository.ts`: Prisma operations
   - `batch-evaluation.repository.ts`: Elasticsearch operations
   - `experiment.repository.ts`: Experiment management
3. **Middleware** (`middleware/evaluation-service.ts`): Dependency injection
4. **Schemas** (`schemas/`): Input/output validation
5. **Routes** (`app.v1.ts`): HTTP handlers with OpenAPI documentation

## Service Layer

### EvaluationService

Handles individual evaluation requests with the following key methods:

- `runEvaluation(options)`: Execute an evaluation with given parameters
- `getEvaluatorCheckType(projectId, evaluatorSlug)`: Determine evaluator type
- `getStoredEvaluator(projectId, evaluatorSlug)`: Retrieve stored evaluator config

### BatchEvaluationService

Handles batch evaluation result logging:

- `logResults(options)`: Process and store batch evaluation results
- `findOrCreateExperiment(projectId, params)`: Manage experiment lifecycle
- `prepareBatchEvaluation(params, experimentId, projectId)`: Format data for storage

## Repository Layer

### EvaluationRepository

Abstracts Prisma database operations:
- `findStoredEvaluator()`: Query stored evaluator configurations
- `createCost()`: Record evaluation costs

### BatchEvaluationRepository

Handles Elasticsearch operations:
- `storeBatchEvaluation()`: Store results in Elasticsearch
- `findOrCreateExperiment()`: Delegate to experiment repository

### ExperimentRepository

Manages experiment lifecycle:
- `findOrCreateExperiment()`: Find existing or create new experiments

## Migration from Old API

The API has been migrated from Next.js API routes to the new Hono pattern while maintaining full backward compatibility:

### Old Structure (Removed)
```text
src/pages/api/evaluations/
├── list.ts
├── batch/
│   └── log_results.ts
└── [evaluator]/
    ├── evaluate.ts
    └── [subpath]/
        └── evaluate.ts
```

### New Structure
```text
src/app/api/evaluations/
├── [[...route]]/
│   ├── app.ts
│   ├── app.v1.ts
│   └── route.ts
├── middleware/
│   └── evaluation-service.ts
└── __tests__/
    └── evaluations.test.ts
```

### Key Improvements

- **Better Error Handling**: Proper HTTP status codes and structured error responses
- **OpenAPI Documentation**: Auto-generated API documentation
- **Structured Logging**: Consistent logging throughout the application
- **Type Safety**: Full TypeScript coverage with proper validation
- **Service-Repository Pattern**: Better separation of concerns and testability
- **Dependency Injection**: No more singletons, proper dependency management
- **Middleware Integration**: Consistent middleware usage across the application

## Testing

### API Tests

Run API layer tests with:
```bash
npm test src/app/api/evaluations/__tests__/evaluations.test.ts
```

Tests cover:
- Route registration verification
- GET evaluators list endpoint
- POST evaluation execution
- POST batch evaluation logging
- Legacy route support
- 404 error handling

### Service Tests

Run service layer tests with:
```bash
npm test src/server/evaluations/__tests__/
```

Tests cover:
- EvaluationService unit tests
- BatchEvaluationService unit tests
- Repository integration tests

## Dependencies

### Core Dependencies
- **Hono**: Lightweight web framework
- **OpenAPI**: API documentation and validation
- **Zod**: Schema validation
- **Prisma**: Database ORM
- **Elasticsearch**: Document storage for batch results

### Internal Dependencies
- **Evaluation Workers**: Background processing
- **Background Queues**: Async task management
- **Sentry**: Error monitoring
- **Logger**: Structured logging

## Error Handling

The API provides consistent error handling:

- **400 Bad Request**: Invalid input parameters
- **404 Not Found**: Evaluator or experiment not found
- **500 Internal Server Error**: Unexpected errors

All errors include structured logging and proper error messages for debugging.

## Performance Considerations

- **Middleware Injection**: Efficient service instantiation per request
- **Repository Pattern**: Easy to optimize data access
- **Batch Processing**: Efficient handling of large result sets
- **Caching**: Evaluator definitions cached where appropriate
- **Async Operations**: Non-blocking evaluation execution

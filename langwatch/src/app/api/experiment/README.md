# Experiments API

This directory contains the new Hono-based Experiments API that follows the service-repository pattern.

## Structure

```text
experiment/
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

### POST /api/experiment/init

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

## Architecture

The API follows the same pattern as the Prompts API:

1. **Service Layer** (`~/server/experiments/experiment.service.ts`): Business logic
2. **Repository Layer** (`~/server/experiments/repositories/experiment.repository.ts`): Data access
3. **Middleware** (`~/app/api/middleware/experiment-service.ts`): Dependency injection
4. **Schemas** (`schemas/`): Input/output validation
5. **Routes** (`app.v1.ts`): HTTP handlers with OpenAPI documentation

## Migration from Old API

The API has been migrated to use the new Hono pattern while maintaining the same URL `/api/experiment/init` with the following improvements:

- Better error handling with proper HTTP status codes
- OpenAPI documentation
- Structured logging
- Type-safe request/response validation
- Service-repository pattern for better testability
- Consistent middleware usage

## Testing

Run tests with:
```bash
npm test src/app/api/experiment/
```

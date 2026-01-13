# Logging Best Practices

## Overview

This document outlines logging conventions for the LangWatch codebase to ensure consistent, useful, and appropriately-leveled logs across all services.

## Logger Creation

Use the `createLogger` utility from `~/utils/logger`:

```typescript
import { createLogger } from "~/utils/logger";

const logger = createLogger("ServiceName");
```

The logger name should identify the module/class (e.g., `"HttpAgentAdapter"`, `"SimulationRunnerService"`).

## Log Levels

### `error` - Failures requiring attention

Use for:
- Unrecoverable errors
- Failed operations that affect functionality
- Exceptions that are caught and re-thrown

```typescript
logger.error({ error, userId, operation }, "Failed to process request");
```

### `warn` - Potential issues

Use for:
- Recoverable errors with fallback behavior
- Deprecated usage detected
- Missing optional configuration
- Unexpected but handled conditions

```typescript
logger.warn({ outputPath }, "JSONPath found no matches, returning full response");
```

### `info` - Significant events

Use for:
- Service/operation start and completion
- Successful completion of major operations
- State transitions
- Events useful for understanding system behavior in production

```typescript
logger.info({ agentId, projectId }, "HttpAgentAdapter.call started");
logger.info({ agentId, resultLength }, "HttpAgentAdapter.call completed");
```

### `debug` - Detailed tracing

Use for:
- Intermediate steps within an operation
- Request/response details
- Configuration values loaded
- Internal state useful for debugging

```typescript
logger.debug({ url, method, hasAuth: !!config.auth }, "HTTP agent config loaded");
logger.debug({ status: response.status, ok: response.ok }, "HTTP response received");
```

## Guidelines

### What to log at each level

| Level | Production Visibility | Use Case |
|-------|----------------------|----------|
| error | Always visible | Failures, exceptions |
| warn  | Always visible | Fallbacks, deprecations |
| info  | Usually visible | Start/end of operations, significant events |
| debug | Requires config | Internal details, step-by-step tracing |

### Structured logging

Always use structured logging with context objects:

```typescript
// Good - structured context
logger.info({ userId, action, duration }, "Request completed");

// Avoid - string interpolation
logger.info(`Request completed for user ${userId} in ${duration}ms`);
```

### Context objects

Include relevant identifiers and state:
- Resource IDs (`agentId`, `projectId`, `scenarioId`)
- Operation context (`url`, `method`, `status`)
- Metrics (`duration`, `resultLength`, `count`)

Avoid logging:
- Sensitive data (passwords, tokens, API keys)
- Large payloads (full request/response bodies)
- PII without explicit need

### Message conventions

- Use present tense for ongoing actions: `"Making HTTP request"`
- Use past tense for completed actions: `"HTTP response received"`
- Be concise but descriptive
- Include the class/function name for clarity: `"HttpAgentAdapter.call started"`

### Entry and exit logging

For significant operations, log at entry and exit:

```typescript
async call(input: AgentInput): Promise<string> {
  logger.info({ agentId: this.agentId }, "HttpAgentAdapter.call started");

  try {
    // ... operation logic with debug logs for intermediate steps

    logger.info({ agentId: this.agentId, resultLength }, "HttpAgentAdapter.call completed");
    return result;
  } catch (error) {
    logger.error({ error, agentId: this.agentId }, "HttpAgentAdapter.call failed");
    throw error;
  }
}
```

## Anti-patterns

### Don't over-log

```typescript
// Too verbose - every line doesn't need a log
logger.debug("Starting to build headers");
headers["Content-Type"] = "application/json";
logger.debug("Added content type header");
headers["Authorization"] = token;
logger.debug("Added authorization header");
```

### Don't under-log

```typescript
// Too sparse - no visibility into what happened
async function processRequest(input) {
  const result = await complexOperation(input);
  return result;
}
```

### Don't log sensitive data

```typescript
// Never do this
logger.debug({ apiKey, password }, "Credentials loaded");

// Do this instead
logger.debug({ hasApiKey: !!apiKey, hasPassword: !!password }, "Credentials loaded");
```

## Related Files

- `src/utils/logger.ts` - Logger factory implementation
- Uses [pino](https://github.com/pinojs/pino) for structured JSON logging

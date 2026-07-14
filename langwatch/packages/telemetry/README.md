# @langwatch/telemetry

Shared logging, request context, and trace-propagation utilities for LangWatch services.

## Logging

Use the same import in browser and Node.js code:

```ts
import { createLogger } from "@langwatch/telemetry";

const logger = createLogger("my-service");
logger.info("hello");
```

There is intentionally no separate server logger. `createLogger` detects Node.js at runtime:

- **Node.js** uses a shared Pino transport, optional OTel log export, SuperJSON error metadata, and registered async request context.
- **Browser** uses Pino's browser output. The root package does not import OpenTelemetry or Node-only modules.

Disable automatic server context injection only for exceptional cases:

```ts
const logger = createLogger("my-service", { disableContext: true });
```

## Server request context

Node-only context helpers are exposed through a feature subpath. Importing it also registers the log context provider:

```ts
import {
  getCurrentContext,
  runWithContext,
  updateCurrentContext,
} from "@langwatch/telemetry/context";

runWithContext({ organizationId: "org-1", projectId: "project-1" }, () => {
  logger.info("processing request");
  updateCurrentContext({ userId: "user-1" });
});
```

Queue producers and consumers can use `getJobContextMetadata` and `createContextFromJobData` from the same subpath.

## Trace propagation

OpenTelemetry helpers are also isolated from the browser-safe package root:

```ts
import {
  getActiveTraceId,
  injectTraceContextHeaders,
} from "@langwatch/telemetry/tracing";

const { headers, traceId } = injectTraceContextHeaders({ headers: {} });
```

## HTTP request logging

```ts
import { getStatusCodeFromError, logHttpRequest } from "@langwatch/telemetry";

logHttpRequest(logger, {
  method: "GET",
  url: "/api/traces",
  statusCode: 200,
  duration: 42,
  userAgent: "curl/8.0",
});
```

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PINO_LOG_LEVEL` | `debug` in Node.js, `info` in browser | Base logger level |
| `LOG_CONSOLE_LEVEL` | `info` | Console level (`PINO_CONSOLE_LEVEL` is the compatibility fallback) |
| `LOG_OTEL_LEVEL` | `debug` | OTel level (`PINO_OTEL_LEVEL` is the compatibility fallback) |
| `PINO_OTEL_ENABLED` | `false` | Set to `true` to enable OTel log export |

## Testing

```bash
pnpm test:unit
```

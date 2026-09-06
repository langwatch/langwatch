import { SpanStatusCode, type Tracer } from "@opentelemetry/api";
import { handlerManagedAuth, publicEndpoint } from "@langwatch/api";
import { registerRoutePolicy } from "@langwatch/api/rest";
import type { Logger } from "@langwatch/observability";
import { Hono } from "hono";

/**
 * A boot-time dependency probe. It runs before the API listener accepts
 * traffic; the public health route remains an inexpensive liveness probe.
 */
export abstract class ApiReadinessPort {
  abstract assertReady(): Promise<void>;
}

/**
 * Process-owned metrics transport. It owns its own authentication and metric
 * registry so API composition never imports a platform-global registry.
 */
export abstract class ApiMetricsPort {
  abstract respond(request: Request): Promise<Response>;
}

export type ApiRequestFailure = Readonly<{
  request: Request;
  error: unknown;
}>;

/** Records an uncaught HTTP failure without changing its client response. */
export abstract class ApiRequestFailureCapturePort {
  abstract capture(failure: ApiRequestFailure): Promise<void>;
}

/** Binds request failures to the API process's configured logger and tracer. */
export class ObservabilityApiRequestFailureCaptureAdapter extends ApiRequestFailureCapturePort {
  static create(options: {
    logger: Pick<Logger, "error">;
    tracer: Tracer;
  }): ObservabilityApiRequestFailureCaptureAdapter {
    return new ObservabilityApiRequestFailureCaptureAdapter(options.logger, options.tracer);
  }

  private constructor(
    private readonly logger: Pick<Logger, "error">,
    private readonly tracer: Tracer,
  ) {
    super();
  }

  async capture(failure: ApiRequestFailure): Promise<void> {
    const error = asError(failure.error);
    const url = new URL(failure.request.url);
    const attributes = {
      "http.request.method": failure.request.method,
      "url.path": url.pathname,
    };

    this.tracer.startActiveSpan("api http request failed", (span) => {
      span.setAttributes(attributes);
      span.recordException(error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
      span.end();
    });
    this.logger.error({ ...attributes, error }, "API HTTP request failed");
  }
}

/**
 * The small process-owned HTTP surface that is independent of product routes.
 * `/api/health` intentionally mirrors the current platform route: both GET
 * and HEAD return an empty 204 after boot completed its readiness gate.
 */
export class ApiProcessLifecycleRoutes {
  static create(options: { metrics?: ApiMetricsPort; rest?: Hono }): Hono {
    const routes = new Hono();
    // Process-owned, so they carry no builder chain — but the boot assertion
    // reads the registry, and a route missing from it is indistinguishable
    // from one smuggled past the builder. Declared here, where they are made.
    const health = publicEndpoint("unauthenticated liveness probe: answers 204 and reads nothing");
    for (const method of ["GET", "HEAD"]) {
      registerRoutePolicy({
        method,
        path: "/api/health",
        policy: health,
        family: "process-lifecycle",
        credentialClass: "none",
      });
    }
    routes.get("/api/health", (context) => context.body(null, 204));
    routes.on("HEAD", "/api/health", (context) => context.body(null, 204));

    const metrics = options.metrics;
    if (metrics) {
      registerRoutePolicy({
        method: "GET",
        path: "/metrics",
        policy: handlerManagedAuth({
          reason: "the metrics transport authenticates the scrape itself",
          permissions: [],
          credential: "internal",
        }),
        family: "process-lifecycle",
        credentialClass: "internal",
      });
      routes.get("/metrics", (context) => metrics.respond(context.req.raw));
    }

    if (options.rest) {
      routes.route("/", options.rest);
    }
    return routes;
  }
}

function asError(value: unknown): Error {
  if (value instanceof Error) return value;
  return new Error(typeof value === "string" ? value : "Unknown API HTTP failure");
}

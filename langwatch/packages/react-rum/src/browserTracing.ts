/**
 * Browser tracing: the half of a trace that happens before the request leaves
 * the tab.
 *
 * Exports OTLP to the app's own origin rather than to a collector directly —
 * same-origin means no CORS and no internet-facing collector. The host app is
 * expected to proxy {@link RUM_TRACES_PATH} on to a collector. See ADR-058.
 *
 * Everything here is best-effort. Telemetry that breaks the page it is
 * measuring is worse than no telemetry, so the whole bootstrap is wrapped and
 * a failure leaves the app running untraced.
 */

import { context, propagation, trace } from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { DocumentLoadInstrumentation } from "@opentelemetry/instrumentation-document-load";
import { FetchInstrumentation } from "@opentelemetry/instrumentation-fetch";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import {
  StackContextManager,
  WebTracerProvider,
} from "@opentelemetry/sdk-trace-web";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import { ATTR_DEPLOYMENT_ENVIRONMENT_NAME } from "@opentelemetry/semantic-conventions/incubating";

import {
  RUM_SERVICE_NAME,
  RUM_SESSION_HEADER,
  RUM_TRACES_PATH,
} from "./constants";
import { currentSessionId } from "./session";
import { SessionSpanProcessor } from "./sessionSpanProcessor";

let started = false;

/**
 * Starts browser tracing once per page. Safe to call repeatedly — React strict
 * mode and remounts both do.
 */
export function startBrowserTracing({
  environment,
  serviceVersion,
}: {
  environment?: string;
  serviceVersion?: string;
} = {}): void {
  if (started || typeof window === "undefined") return;
  started = true;

  try {
    const provider = new WebTracerProvider({
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: RUM_SERVICE_NAME,
        ...(serviceVersion ? { [ATTR_SERVICE_VERSION]: serviceVersion } : {}),
        ...(environment
          ? { [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: environment }
          : {}),
      }),
      spanProcessors: [
        new SessionSpanProcessor(),
        new BatchSpanProcessor(
          new OTLPTraceExporter({
            url: RUM_TRACES_PATH,
            headers: sessionHeader(),
          }),
        ),
      ],
    });

    provider.register({
      contextManager: new StackContextManager().enable(),
      propagator: new W3CTraceContextPropagator(),
    });

    registerInstrumentations({
      instrumentations: [
        new DocumentLoadInstrumentation(),
        new FetchInstrumentation({
          // Only our own origin is given trace context. Sending `traceparent`
          // to a third party leaks our topology and trips their CORS anyway.
          propagateTraceHeaderCorsUrls: [new RegExp(`^${escapeRegExp(window.location.origin)}`)],
          // The exporter's own requests would otherwise produce spans that
          // produce requests that produce spans.
          ignoreUrls: [new RegExp(escapeRegExp(RUM_TRACES_PATH))],
          clearTimingResources: true,
        }),
      ],
    });
  } catch {
    // Leave the page untraced rather than broken.
    started = false;
  }
}

/**
 * Read once at construction: the exporter's headers are fixed, and the session
 * travels per-span as `session.id` anyway. This header exists so the ingest
 * route can rate limit per browser instead of per IP, where an office behind
 * one address would throttle each other.
 */
function sessionHeader(): Record<string, string> {
  const sessionId = currentSessionId();
  return sessionId ? { [RUM_SESSION_HEADER]: sessionId } : {};
}

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Test seam: lets a suite start tracing again with a fresh provider. */
export function resetBrowserTracingForTesting(): void {
  started = false;
  trace.disable();
  context.disable();
  propagation.disable();
}

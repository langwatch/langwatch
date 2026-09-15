/**
 * Browser tracing: the half of a trace that happens before the request leaves the tab. Exports
 * OTLP to the app's own origin, not a collector directly (no CORS, no internet-facing collector;
 * the host app proxies {@link RUM_TRACES_PATH} on, see ADR-058). Best-effort throughout: the
 * whole bootstrap is wrapped so telemetry that breaks the page it measures leaves it untraced.
 */

import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { DocumentLoadInstrumentation } from "@opentelemetry/instrumentation-document-load";
import { FetchInstrumentation } from "@opentelemetry/instrumentation-fetch";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { WebTracerProvider } from "@opentelemetry/sdk-trace-web";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import { ATTR_DEPLOYMENT_ENVIRONMENT_NAME } from "@opentelemetry/semantic-conventions/incubating";

import {
  RUM_DEFAULT_SAMPLE_RATIO,
  RUM_SERVICE_NAME,
  RUM_SESSION_HEADER,
  RUM_TRACES_PATH,
} from "./constants.ts";
import { NavigationContextManager } from "./navigationContextManager.ts";
import { createBrowserSampler } from "./sampling.ts";
import { currentSessionId } from "./session.ts";
import { SessionSpanProcessor } from "./sessionSpanProcessor.ts";

let started = false;

/**
 * Starts browser tracing once per page. Safe to call repeatedly — React strict
 * mode and remounts both do.
 */
export function startBrowserTracing({
  environment,
  serviceVersion,
  sampleRatio = RUM_DEFAULT_SAMPLE_RATIO,
}: {
  environment?: string;
  serviceVersion?: string;
  /**
   * Share of sessions recorded, in [0, 1]. Whole sessions rather than
   * individual traces, and the decision reaches the backend too — see
   * `sampling.ts`.
   */
  sampleRatio?: number;
} = {}): void {
  // Never reset, even when the bootstrap below throws part-way. By then a
  // provider and an exporter may already be globally registered, and a second
  // attempt would leave the first one orphaned and exporting.
  if (started || typeof window === "undefined") return;
  started = true;

  try {
    const provider = new WebTracerProvider({
      sampler: createBrowserSampler({ ratio: sampleRatio }),
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: RUM_SERVICE_NAME,
        ...(serviceVersion ? { [ATTR_SERVICE_VERSION]: serviceVersion } : {}),
        ...(environment ? { [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: environment } : {}),
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
      // A navigation parents the fetches it triggers; the stock stack manager
      // cannot follow the async gap between the two. See
      // `navigationContextManager.ts`.
      contextManager: new NavigationContextManager().enable(),
      propagator: new W3CTraceContextPropagator(),
    });

    registerInstrumentations({
      instrumentations: [
        new DocumentLoadInstrumentation(),
        new FetchInstrumentation({
          // Only our own origin is given trace context. Sending `traceparent`
          // to a third party leaks our topology and trips their CORS anyway.
          // The trailing boundary matters: a bare prefix match would also
          // accept `https://app.example.com.evil.test`, which is a lookalike
          // host somebody else controls.
          propagateTraceHeaderCorsUrls: [
            new RegExp(`^${escapeRegExp(window.location.origin)}(?:/|$)`),
          ],
          // The exporter's own requests would otherwise produce spans that
          // produce requests that produce spans.
          ignoreUrls: [new RegExp(escapeRegExp(RUM_TRACES_PATH))],
          clearTimingResources: true,
        }),
      ],
    });
  } catch {
    // Leave the page untraced rather than broken.
    return;
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

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

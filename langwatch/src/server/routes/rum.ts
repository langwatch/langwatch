/**
 * Ingest for browser telemetry: `POST /api/rum/v1/traces`.
 *
 * The browser exports OTLP here rather than to the collector directly. That is
 * deliberate — production keeps OTLP off the internet, and the collector's
 * bearer filter guards only its traces pipeline, so exposing it would also
 * expose an unauthenticated log sink. Proxying through the app's own origin
 * means no CORS, no new internet-facing infrastructure, and the request-size
 * and rate limits below applied before anything reaches the collector.
 *
 * Everything arriving here is untrusted: anyone can post to a public route and
 * assert any trace id. The blast radius of a polluted trace is a confusing
 * Tempo query rather than a security boundary, so this bounds the damage rather
 * than trying to prove authenticity.
 *
 * See ADR-058 and specs/observability/browser-rum-trace-correlation.feature.
 */

import { createLogger } from "@langwatch/observability";
import type { Context } from "hono";
import { createServiceApp, publicEndpoint } from "~/server/api/security";
import { rateLimit } from "~/server/rateLimit";
import {
  RUM_MAX_BODY_BYTES,
  RUM_SESSION_HEADER,
  RUM_SERVICE_NAME,
  RUM_TRACES_PATH,
} from "@langwatch/react-rum";

const logger = createLogger("langwatch:rum:ingest");

const secured = createServiceApp({ basePath: "/api/rum" });

/** Shape we care about in an OTLP/JSON trace export; everything else passes through. */
interface OtlpAttribute {
  key?: string;
  value?: { stringValue?: string };
}
export interface OtlpResourceSpans {
  resource?: { attributes?: OtlpAttribute[] };
}
export interface OtlpTraceExport {
  resourceSpans?: OtlpResourceSpans[];
}

const attributeValue = (
  attributes: OtlpAttribute[] | undefined,
  key: string,
): string | undefined =>
  attributes?.find((attribute) => attribute.key === key)?.value?.stringValue;

/**
 * The collector the proxied export is forwarded to. Shares
 * `OTEL_EXPORTER_OTLP_ENDPOINT` with `instrumentation.node.ts`, so the browser's
 * telemetry lands beside the server's without a second thing to configure.
 * Unset means no collector, which is how this route stays inert by default.
 */
const collectorTracesUrl = (): string | undefined => {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.replace(/\/+$/, "");
  return endpoint ? `${endpoint}/v1/traces` : void 0;
};

/**
 * Rate-limit identity: the browser's own session when it names one, falling
 * back to the address. Sessions are self-asserted and trivially rotated, so
 * this is a bound on accidental floods rather than on a determined abuser —
 * which is the right target for telemetry.
 */
const rateLimitKey = (c: Context): string => {
  const session = c.req.header(RUM_SESSION_HEADER);
  if (session) return `rum:session:${session.slice(0, 64)}`;

  const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
  return `rum:ip:${forwarded ?? "unknown"}`;
};

secured
  .access(
    publicEndpoint(
      "Browser telemetry ingest; the browser has no credential to present and the payload is treated as untrusted",
    ),
  )
  .post(RUM_TRACES_PATH.replace("/api/rum", ""), async (c) => {
    const forwardTo = collectorTracesUrl();
    if (!forwardTo) return c.json({ error: "Not enabled" }, 404);

    const limit = await rateLimit({
      key: rateLimitKey(c),
      windowSeconds: 60,
      max: 120,
    });
    if (!limit.allowed) return c.json({ error: "Too many requests" }, 429);

    const declaredLength = Number(c.req.header("content-length") ?? 0);
    if (declaredLength > RUM_MAX_BODY_BYTES) {
      return c.json({ error: "Payload too large" }, 413);
    }

    const body = await c.req.text();
    // Re-check against the real body: content-length is caller-supplied and a
    // chunked request need not send one at all.
    if (body.length > RUM_MAX_BODY_BYTES) {
      return c.json({ error: "Payload too large" }, 413);
    }

    let payload: OtlpTraceExport;
    try {
      payload = JSON.parse(body) as OtlpTraceExport;
    } catch {
      return c.json({ error: "Malformed payload" }, 400);
    }

    const resourceSpans = payload.resourceSpans;
    if (!Array.isArray(resourceSpans) || resourceSpans.length === 0) {
      return c.json({ error: "Malformed payload" }, 400);
    }

    if (claimsAnotherService(resourceSpans)) {
      return c.json({ error: "Unexpected service" }, 400);
    }

    stampPlatformOrigin(resourceSpans);

    try {
      const response = await fetch(forwardTo, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        logger.warn(
          { status: response.status },
          "collector rejected browser telemetry",
        );
        // Surfaced rather than swallowed so the browser's exporter can retry;
        // silently 200-ing here would discard the spans for good.
        return c.json({ error: "Upstream rejected" }, 502);
      }
    } catch (error) {
      logger.warn({ error }, "could not forward browser telemetry");
      return c.json({ error: "Upstream unavailable" }, 502);
    }

    return c.body(null, 202);
  });

/**
 * Whether any part of the export claims to come from something other than the
 * browser app. Nothing here proves authorship — the point is to keep unrelated
 * services out of the browser's trace stream, not to authenticate it.
 */
export function claimsAnotherService(
  resourceSpans: OtlpResourceSpans[],
): boolean {
  return resourceSpans.some(
    (resourceSpan) =>
      attributeValue(resourceSpan.resource?.attributes, "service.name") !==
      RUM_SERVICE_NAME,
  );
}

/**
 * Marks the telemetry as the platform describing itself, the same way the
 * server and the Go services do, so a misrouted payload is recognisable
 * wherever it lands.
 *
 * Set here rather than trusted from the browser: the point of the marker is
 * that it cannot be omitted, and a value the client supplies could be.
 */
export function stampPlatformOrigin(resourceSpans: OtlpResourceSpans[]): void {
  for (const resourceSpan of resourceSpans) {
    const attributes = (resourceSpan.resource ??= {}).attributes ?? [];
    resourceSpan.resource.attributes = [
      ...attributes.filter((attribute) => attribute.key !== "langwatch.origin"),
      {
        key: "langwatch.origin",
        value: { stringValue: "platform_internal" },
      },
    ];
  }
}

export const app = secured.hono;

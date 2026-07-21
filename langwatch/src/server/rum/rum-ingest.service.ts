/**
 * Accepts an OTLP/JSON trace export from a browser and forwards it to the
 * collector.
 *
 * Everything reaching this service is untrusted: the route is public by
 * necessity (a browser has no credential to present), so the payload is
 * attacker-controlled and the caller's identity is self-asserted. The service
 * therefore does not try to prove authorship — it bounds what a payload can
 * cost us and what it can claim to be:
 *
 *   - the body is capped in bytes before it is buffered, so an unbounded
 *     upload cannot exhaust the process
 *   - the span count is capped, because a small body can hold a lot of spans
 *   - identity-carrying resource attributes are *overwritten* rather than
 *     validated, so no payload can attribute itself to another service
 *
 * See ADR-058 and specs/observability/browser-rum-trace-correlation.feature.
 */

import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import {
  RUM_MAX_BODY_BYTES,
  RUM_MAX_SPANS,
  RUM_SERVICE_NAME,
} from "@langwatch/react-rum";
import { rateLimit } from "~/server/rateLimit";

const logger = createLogger("langwatch:rum:ingest");

/** Shape we care about in an OTLP/JSON trace export; everything else passes through. */
interface OtlpAttribute {
  key?: string;
  value?: { stringValue?: string };
}
export interface OtlpResourceSpans {
  resource?: { attributes?: OtlpAttribute[] };
  scopeSpans?: { spans?: unknown[] }[];
}
export interface OtlpTraceExport {
  resourceSpans?: OtlpResourceSpans[];
}

export class RumIngestDisabledError extends HandledError {
  constructor() {
    super("rum_ingest_disabled", "Browser telemetry ingest is not configured", {
      httpStatus: 404,
      fault: "platform",
    });
  }
}

export class RumPayloadTooLargeError extends HandledError {
  constructor(message: string) {
    super("rum_payload_too_large", message, {
      httpStatus: 413,
      fault: "customer",
    });
  }
}

export class RumPayloadInvalidError extends HandledError {
  constructor(message: string) {
    super("rum_payload_invalid", message, {
      httpStatus: 400,
      fault: "customer",
    });
  }
}

export class RumRateLimitedError extends HandledError {
  constructor() {
    super("rum_rate_limited", "Too many telemetry reports", {
      httpStatus: 429,
      fault: "customer",
    });
  }
}

/**
 * The collector the proxied export is forwarded to. Shares
 * `OTEL_EXPORTER_OTLP_ENDPOINT` with `instrumentation.node.ts`, so the browser's
 * telemetry lands beside the server's without a second thing to configure.
 * Unset means no collector, which is how this route stays inert by default.
 */
export const collectorTracesUrl = (): string | undefined => {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.replace(/\/+$/, "");
  return endpoint ? `${endpoint}/v1/traces` : void 0;
};

/**
 * Headers the collector needs to accept a forwarded export. The collector's
 * traces pipeline can sit behind a bearer filter; `instrumentation.node.ts`
 * gets that for free because the OTLP exporter reads the env var itself, but a
 * hand-rolled fetch has to pass it on or every forward 401s.
 */
export function collectorHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  for (const pair of (process.env.OTEL_EXPORTER_OTLP_HEADERS ?? "").split(",")) {
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if (name && value) headers[name.toLowerCase()] = value;
  }
  return headers;
}

/**
 * Reads the request body, refusing to buffer more than the cap.
 *
 * The `content-length` header is only a hint — a chunked request need not send
 * one, and a lying one is free to send. So the limit is enforced against bytes
 * actually read: without this, `await c.req.text()` would happily materialise a
 * 500MB string before any size check could reject it.
 */
export async function readCappedBody(
  request: Request,
  maxBytes = RUM_MAX_BODY_BYTES,
): Promise<string> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new RumPayloadTooLargeError("Payload too large");
  }

  const body = request.body;
  if (!body) return "";

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new RumPayloadTooLargeError("Payload too large");
      }
      chunks.push(value);
    }
  } finally {
    // Releases the connection early on the rejection path; without it an
    // oversized upload keeps streaming into a body nobody is reading.
    void reader.cancel().catch(() => void 0);
  }

  return new TextDecoder().decode(concat(chunks, total));
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** Total spans across every resource/scope in the export. */
export function countSpans(resourceSpans: OtlpResourceSpans[]): number {
  let count = 0;
  for (const resourceSpan of resourceSpans) {
    for (const scopeSpan of resourceSpan.scopeSpans ?? []) {
      count += scopeSpan.spans?.length ?? 0;
    }
  }
  return count;
}

/**
 * Replaces the resource attributes that carry identity.
 *
 * Overwriting beats validating. A check for "does this claim to be someone
 * else" has to reason about a *repeated* attribute list where collectors take
 * the last value and a naive check takes the first — so appending a second
 * `service.name` slips a forged identity past any first-match test. Setting the
 * values ourselves removes the question: whatever the browser sent, what leaves
 * here is this service, marked as the platform describing itself.
 */
export function stampIdentity(resourceSpans: OtlpResourceSpans[]): void {
  const owned = new Set(["service.name", "langwatch.origin"]);
  for (const resourceSpan of resourceSpans) {
    const resource = (resourceSpan.resource ??= {});
    const attributes = resource.attributes ?? [];
    resource.attributes = [
      ...attributes.filter(
        (attribute) => !owned.has(attribute.key ?? ""),
      ),
      { key: "service.name", value: { stringValue: RUM_SERVICE_NAME } },
      {
        key: "langwatch.origin",
        value: { stringValue: "platform_internal" },
      },
    ];
  }
}

/**
 * Rate-limit buckets.
 *
 * The per-caller bucket is fairness, not defence: the session is self-asserted
 * and the address is only as trustworthy as the proxy in front of us, so an
 * abuser rotates either one and lands in a fresh bucket every time. The global
 * bucket is the actual bound — it caps what the whole route can push at the
 * collector no matter how many identities the traffic claims.
 */
export const RUM_PER_CALLER_PER_MINUTE = 120;
export const RUM_GLOBAL_PER_MINUTE = 6_000;

export async function enforceRateLimits(callerKey: string): Promise<void> {
  const perCaller = await rateLimit({
    key: `rum:caller:${callerKey}`,
    windowSeconds: 60,
    max: RUM_PER_CALLER_PER_MINUTE,
  });
  if (!perCaller.allowed) throw new RumRateLimitedError();

  const global = await rateLimit({
    key: "rum:global",
    windowSeconds: 60,
    max: RUM_GLOBAL_PER_MINUTE,
  });
  if (!global.allowed) throw new RumRateLimitedError();
}

/**
 * Validates and forwards one export. Throws `HandledError` on refusal; returns
 * normally when the collector has accepted the spans.
 */
export async function ingestBrowserTraces({
  body,
  callerKey,
}: {
  body: string;
  callerKey: string;
}): Promise<void> {
  const forwardTo = collectorTracesUrl();
  if (!forwardTo) throw new RumIngestDisabledError();

  await enforceRateLimits(callerKey);

  let payload: OtlpTraceExport;
  try {
    payload = JSON.parse(body) as OtlpTraceExport;
  } catch {
    throw new RumPayloadInvalidError("Malformed payload");
  }

  const resourceSpans = payload.resourceSpans;
  if (!Array.isArray(resourceSpans) || resourceSpans.length === 0) {
    throw new RumPayloadInvalidError("Malformed payload");
  }

  const spans = countSpans(resourceSpans);
  if (spans === 0) throw new RumPayloadInvalidError("Malformed payload");
  if (spans > RUM_MAX_SPANS) {
    throw new RumPayloadTooLargeError("Too many spans");
  }

  stampIdentity(resourceSpans);

  try {
    const response = await fetch(forwardTo, {
      method: "POST",
      headers: collectorHeaders(),
      body: JSON.stringify(payload),
      // A hung collector must not pin an app request (and its buffered body)
      // open for the browser's whole export timeout.
      signal: AbortSignal.timeout(5_000),
    });

    if (!response.ok) {
      logger.warn(
        { status: response.status },
        "collector rejected browser telemetry",
      );
    }
  } catch (error) {
    logger.warn({ error }, "could not forward browser telemetry");
  }
  // Deliberately not surfaced to the browser. A 5xx here is in the OTLP
  // retryable set, so a collector outage would turn every open tab into a
  // retry loop against our own app — converting an observability outage into a
  // traffic incident. The drop is visible server-side in these logs, which is
  // where someone can act on it.
}

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

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Confirms the export is walkable before anything walks it.
 *
 * Checking that `resourceSpans` is an array is not enough on its own, because
 * what runs next reaches inside it: `countSpans` iterates `scopeSpans` and
 * `stampIdentity` calls `.filter` on `resource.attributes`. A payload that
 * makes either of those a string or an object throws a `TypeError`, and the
 * route answers 500 to a body the caller chose. On a public endpoint that is a
 * way to provoke server errors at will, so a shape we cannot walk is refused as
 * the malformed input it is. Only the fields we touch are checked; everything
 * else still passes through to the collector untouched.
 */
export function assertWalkableExport(resourceSpans: unknown[]): void {
  const invalid = () => new RumPayloadInvalidError("Malformed payload");

  for (const resourceSpan of resourceSpans) {
    if (!isObject(resourceSpan)) throw invalid();

    const { resource, scopeSpans } = resourceSpan;

    if (resource !== void 0) {
      if (!isObject(resource)) throw invalid();
      const { attributes } = resource;
      if (attributes !== void 0) {
        if (!Array.isArray(attributes)) throw invalid();
        if (attributes.some((attribute) => !isObject(attribute))) throw invalid();
      }
    }

    if (scopeSpans !== void 0) {
      if (!Array.isArray(scopeSpans)) throw invalid();
      for (const scopeSpan of scopeSpans) {
        if (!isObject(scopeSpan)) throw invalid();
        const { spans } = scopeSpan;
        if (spans !== void 0 && !Array.isArray(spans)) throw invalid();
      }
    }
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
  // The global bucket is checked first because the per-caller key is built from
  // a value the caller chooses. Checking that one first means every request
  // writes a fresh 60s key whenever the caller rotates its session header — so
  // a flood that the global cap is already refusing would still mint a Redis
  // key per request, turning a refusal into unbounded key churn. Refusing on
  // the global bucket first writes nothing the caller controls the name of.
  const global = await rateLimit({
    key: "rum:global",
    windowSeconds: 60,
    max: RUM_GLOBAL_PER_MINUTE,
  });
  if (!global.allowed) throw new RumRateLimitedError();

  const perCaller = await rateLimit({
    key: `rum:caller:${callerKey}`,
    windowSeconds: 60,
    max: RUM_PER_CALLER_PER_MINUTE,
  });
  if (!perCaller.allowed) throw new RumRateLimitedError();
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

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new RumPayloadInvalidError("Malformed payload");
  }

  // `JSON.parse` answers with any JSON value, not just an object — a body of
  // `null` reads the property off nothing and throws.
  if (!isObject(parsed)) throw new RumPayloadInvalidError("Malformed payload");
  const payload = parsed as OtlpTraceExport;

  const resourceSpans = payload.resourceSpans;
  if (!Array.isArray(resourceSpans) || resourceSpans.length === 0) {
    throw new RumPayloadInvalidError("Malformed payload");
  }
  assertWalkableExport(resourceSpans);

  const spans = countSpans(resourceSpans);
  if (spans === 0) throw new RumPayloadInvalidError("Malformed payload");
  if (spans > RUM_MAX_SPANS) {
    throw new RumPayloadTooLargeError("Too many spans");
  }

  stampIdentity(resourceSpans);

  // Not awaited. The browser has nothing to do with the answer — the outcome is
  // never surfaced to it (see below) — so waiting would only hold a live
  // connection open for as long as the collector takes to fail, which during an
  // outage is every request for the full timeout. The app is a long-running
  // Node process, not a serverless function, so the promise keeps running after
  // the response is sent.
  void forwardToCollector({ forwardTo, payload });
}

async function forwardToCollector({
  forwardTo,
  payload,
}: {
  forwardTo: string;
  payload: OtlpTraceExport;
}): Promise<void> {
  try {
    const response = await fetch(forwardTo, {
      method: "POST",
      headers: collectorHeaders(),
      body: JSON.stringify(payload),
      // A hung collector must not leave the forward outstanding indefinitely.
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
  // A failure is deliberately not surfaced to the browser. A 5xx would be in
  // the OTLP retryable set, so a collector outage would turn every open tab
  // into a retry loop against our own app — converting an observability outage
  // into a traffic incident. The drop is visible in these logs, which is where
  // someone can act on it.
}

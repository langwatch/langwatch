/**
 * Shared OTLP body read + decompress + parse for both LangWatch OTel
 * receivers:
 *
 *   POST /api/otel/v1/{traces,logs,metrics}     (project-scoped LLM observability)
 *   POST /api/ingest/otel/:sourceId             (org-scoped governance audit feed)
 *
 * The two endpoints serve different products (per-project trace viewer
 * vs cross-platform Activity Monitor), but they share the OTLP wire
 * shape and must therefore share a single hardened parser. Specifically:
 *
 *   - decompression: gzip / deflate / brotli per Content-Encoding (most
 *     production OTel collectors enable gzip by default)
 *   - protobuf + JSON: most production collectors emit protobuf for size,
 *     so JSON-only parsing silently fails them
 *   - JSON-then-protobuf fallback path (for reasonable-looking JSON that
 *     was sent without the right Content-Type)
 *
 * Owners must compose this with their own auth, tenancy resolution,
 * and downstream pipeline (trace pipeline vs OCSF normaliser). The
 * helper deliberately doesn't take an IngestionSource / Project — it
 * stays a pure parser.
 *
 * Background: PR #3524 review (rchaves "we already have a /v1 otel
 * traces endpoint hardened over the years"). Master directive
 * 2026-04-27: keep public URLs separate; converge the receiver
 * internals into a shared module.
 */
import type {
  IExportLogsServiceRequest,
  IExportMetricsServiceRequest,
  IExportTraceServiceRequest,
} from "@opentelemetry/otlp-transformer";
import * as root from "@opentelemetry/otlp-transformer/build/src/generated/root";
import { brotliDecompress, gunzip, inflate } from "node:zlib";
import { promisify } from "node:util";

const gunzipAsync = promisify(gunzip);
const inflateAsync = promisify(inflate);
const brotliDecompressAsync = promisify(brotliDecompress);

const traceRequestType = (root as any).opentelemetry.proto.collector.trace.v1
  .ExportTraceServiceRequest;
const logRequestType = (root as any).opentelemetry.proto.collector.logs.v1
  .ExportLogsServiceRequest;
const metricsRequestType = (root as any).opentelemetry.proto.collector.metrics
  .v1.ExportMetricsServiceRequest;

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return new Uint8Array(buf).buffer as ArrayBuffer;
}

/**
 * Read the request body, decompressing per `Content-Encoding`.
 * Throws on unsupported encodings — the caller decides how to respond.
 */
export async function readOtlpBody(req: Request): Promise<ArrayBuffer> {
  const raw = await req.arrayBuffer();
  const encoding = req.headers.get("content-encoding");

  if (!encoding || encoding === "identity") return raw;
  if (encoding === "gzip") {
    return toArrayBuffer(await gunzipAsync(Buffer.from(raw)));
  }
  if (encoding === "deflate") {
    return toArrayBuffer(await inflateAsync(Buffer.from(raw)));
  }
  if (encoding === "br") {
    return toArrayBuffer(await brotliDecompressAsync(Buffer.from(raw)));
  }
  throw new Error(`Unsupported Content-Encoding: ${encoding}`);
}

export type OtlpParseResult<T> =
  | { ok: true; request: T }
  | { ok: false; error: string };

/**
 * Parse an OTLP/HTTP traces export request from a decompressed body.
 * Accepts protobuf (default) or JSON (when Content-Type is
 * `application/json`). Falls back to JSON-then-protobuf-encode for
 * misconfigured callers — same fallback /v1/traces uses today.
 */
export function parseOtlpTraces(
  body: ArrayBuffer,
  contentType?: string | null,
): OtlpParseResult<IExportTraceServiceRequest> {
  if (body.byteLength === 0) {
    return { ok: true, request: { resourceSpans: [] } };
  }
  return parseWithFallback<IExportTraceServiceRequest>(
    body,
    contentType,
    traceRequestType,
  );
}

export function parseOtlpLogs(
  body: ArrayBuffer,
  contentType?: string | null,
): OtlpParseResult<IExportLogsServiceRequest> {
  if (body.byteLength === 0) {
    return { ok: true, request: { resourceLogs: [] } };
  }
  return parseWithFallback<IExportLogsServiceRequest>(
    body,
    contentType,
    logRequestType,
  );
}

export function parseOtlpMetrics(
  body: ArrayBuffer,
  contentType?: string | null,
): OtlpParseResult<IExportMetricsServiceRequest> {
  if (body.byteLength === 0) {
    return { ok: true, request: { resourceMetrics: [] } };
  }
  return parseWithFallback<IExportMetricsServiceRequest>(
    body,
    contentType,
    metricsRequestType,
  );
}

function parseWithFallback<T>(
  body: ArrayBuffer,
  contentType: string | null | undefined,
  protoType: { decode: (buf: Uint8Array) => T; encode: (msg: T) => { finish: () => Uint8Array } },
): OtlpParseResult<T> {
  let request: T;
  try {
    if (contentType === "application/json") {
      request = JSON.parse(Buffer.from(body).toString("utf-8")) as T;
    } else {
      request = protoType.decode(new Uint8Array(body));
    }
    return { ok: true, request };
  } catch (firstErr) {
    // JSON-then-protobuf-encode fallback (mirrors hardened /v1/traces
    // path): some clients send JSON without setting Content-Type, or
    // send protobuf-shaped bytes with `application/json`. Re-encoding
    // through the protobuf type both validates the structure and
    // normalises any wire-format quirks before downstream consumers
    // see it.
    try {
      const json = JSON.parse(Buffer.from(body).toString("utf-8")) as T;
      request = protoType.decode(
        new Uint8Array(protoType.encode(json).finish()),
      );
      return { ok: true, request };
    } catch (jsonErr) {
      return {
        ok: false,
        error: `Failed to parse OTLP body: ${(firstErr as Error).message} (json fallback: ${(jsonErr as Error).message})`,
      };
    }
  }
}

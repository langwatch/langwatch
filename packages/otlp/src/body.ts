/**
 * Shared OTLP body read + decompress + parse for both LangWatch OTel
 * receivers (project-scoped traces, org-scoped governance ingest), which
 * share the wire shape but compose their own auth, tenancy and pipeline.
 */

import { promisify } from "node:util";
import { brotliDecompress, gunzip, inflate } from "node:zlib";

import type {
  IExportLogsServiceRequest,
  IExportMetricsServiceRequest,
  IExportTraceServiceRequest,
} from "@opentelemetry/otlp-transformer";
import * as rootModule from "@opentelemetry/otlp-transformer/build/src/generated/root.js";

import {
  OtlpBodyTooLargeError,
  OtlpBodyUnreadableError,
  OtlpUnsupportedEncodingError,
} from "./errors.ts";

const gunzipAsync = promisify(gunzip);
const inflateAsync = promisify(inflate);
const brotliDecompressAsync = promisify(brotliDecompress);

/**
 * `.../generated/root` is CommonJS: a bundler's interop shim (Vite) puts the
 * exports on `.default`, Node's own ESM loader leaves them on the namespace —
 * reading `default` first, namespace second, covers both.
 */
export const otlpProtobufRoot: Record<string, any> =
  (rootModule as { default?: Record<string, any> }).default ?? rootModule;

const root = otlpProtobufRoot;

const traceRequestType = root.opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest;
const logRequestType = root.opentelemetry.proto.collector.logs.v1.ExportLogsServiceRequest;
const metricsRequestType =
  root.opentelemetry.proto.collector.metrics.v1.ExportMetricsServiceRequest;

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return new Uint8Array(buf).buffer as ArrayBuffer;
}

/**
 * The read cap and the post-decompress cap, as one number — a compressed
 * body's expansion ratio is chosen by the sender and cannot be trusted.
 * Applied here because the governance ingest routes carry no `bodyLimit`.
 */
export const OTLP_MAX_BODY_BYTES = 10 * 1024 * 1024;

/**
 * Node reports the cap as a RangeError with this code rather than anything
 * zlib-specific, and it is the only signal distinguishing "too big" from a
 * genuinely corrupt stream.
 */
function isOutputLimitExceeded(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "ERR_BUFFER_TOO_LARGE"
  );
}

type Decompressor = (buf: Buffer, opts: { maxOutputLength: number }) => Promise<Buffer>;

const DECOMPRESSORS = {
  gzip: gunzipAsync,
  deflate: inflateAsync,
  br: brotliDecompressAsync,
} as const satisfies Record<string, Decompressor>;

type SupportedEncoding = keyof typeof DECOMPRESSORS;

function isSupportedEncoding(encoding: string): encoding is SupportedEncoding {
  return encoding in DECOMPRESSORS;
}

/**
 * Swallows the throw: a torn-down stream's `releaseLock()` can throw from a
 * `finally` block, which would REPLACE the real error already on its way out.
 */
function releaseQuietly(reader: { releaseLock: () => void }): void {
  try {
    reader.releaseLock();
  } catch {
    // See above: the failure already on its way out is the diagnosis.
    return;
  }
}

/** Same reasoning as {@link releaseQuietly}, for the over-size cancel path. */
async function cancelQuietly(reader: { cancel: () => Promise<void> }): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    // The refusal we are about to throw is the diagnosis, not this.
    return;
  }
}

/**
 * Consuming the stream by hand (not `req.arrayBuffer()`, which buffers the
 * whole body first) applies the byte bound before that memory is spent, and
 * every failure — already consumed, dropped, over-size — is the sender's, not a 500.
 */
function acquireReader(
  stream: ReadableStream<Uint8Array>,
): ReadableStreamDefaultReader<Uint8Array> {
  try {
    return stream.getReader();
  } catch (error) {
    throw new OtlpBodyUnreadableError({ cause: error });
  }
}

/** Drain the reader, refusing the body the moment it passes the byte bound. */
async function drainWithinLimit(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  let held = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    held += value.byteLength;
    if (held > OTLP_MAX_BODY_BYTES) {
      await cancelQuietly(reader);
      throw new OtlpBodyTooLargeError({
        maxBytes: OTLP_MAX_BODY_BYTES,
        encoding: null,
      });
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks);
}

async function readWireBody(req: Request): Promise<Buffer> {
  const stream = req.body;
  if (!stream) return Buffer.alloc(0);

  const reader = acquireReader(stream);

  try {
    return await drainWithinLimit(reader);
  } catch (error) {
    // The size refusal is our own verdict and keeps its own status; anything
    // else ended the read from the other end of the connection.
    if (error instanceof OtlpBodyTooLargeError) throw error;
    throw new OtlpBodyUnreadableError({ cause: error });
  } finally {
    releaseQuietly(reader);
  }
}

/**
 * Reads the request body, decompressing per `Content-Encoding`. Throws on
 * unsupported encodings or a body over {@link OTLP_MAX_BODY_BYTES} — bounded
 * by zlib itself, so an oversized body stops being written past the line.
 */
export async function readOtlpBody(req: Request): Promise<ArrayBuffer> {
  const encoding = req.headers.get("content-encoding");
  if (encoding && encoding !== "identity" && !isSupportedEncoding(encoding)) {
    throw new OtlpUnsupportedEncodingError({ encoding });
  }
  return decodeOtlpBody(await readWireBody(req), encoding);
}

export async function decodeOtlpBody(
  bytes: Uint8Array,
  encoding: string | null,
): Promise<ArrayBuffer> {
  if (bytes.byteLength > OTLP_MAX_BODY_BYTES) {
    throw new OtlpBodyTooLargeError({ maxBytes: OTLP_MAX_BODY_BYTES, encoding });
  }
  const raw = Buffer.from(bytes);

  if (!encoding || encoding === "identity") {
    return toArrayBuffer(raw);
  }

  // Settled before the body is read, so a request we are going to refuse
  // outright does not get to spend the read budget first.
  if (!isSupportedEncoding(encoding)) {
    throw new OtlpUnsupportedEncodingError({ encoding });
  }

  // Widened to the shared signature deliberately: the three entries differ in
  // their options type (ZlibOptions vs BrotliOptions), so calling the indexed
  // union directly is not something TypeScript will resolve.
  const decompress: Decompressor = DECOMPRESSORS[encoding];

  try {
    return toArrayBuffer(await decompress(raw, { maxOutputLength: OTLP_MAX_BODY_BYTES }));
  } catch (error) {
    if (isOutputLimitExceeded(error)) {
      throw new OtlpBodyTooLargeError({
        maxBytes: OTLP_MAX_BODY_BYTES,
        encoding,
      });
    }
    // Anything else zlib raises here is a body that does not decompress —
    // truncated by a disconnect, or not the encoding it claimed. Both are the
    // sender's, and neither is a reason to answer 500.
    throw new OtlpBodyUnreadableError({ cause: error });
  }
}

export type OtlpParseResult<T> = { ok: true; request: T } | { ok: false; error: string };

/**
 * Parses an OTLP/HTTP traces export request. Accepts protobuf (default) or
 * JSON (Content-Type `application/json`), falling back to JSON-then-protobuf
 * for misconfigured callers, matching /v1/traces.
 */
export function parseOtlpTraces(
  body: ArrayBuffer,
  contentType?: string | null,
): OtlpParseResult<IExportTraceServiceRequest> {
  if (body.byteLength === 0) {
    return { ok: true, request: { resourceSpans: [] } };
  }
  return parseWithFallback<IExportTraceServiceRequest>(body, contentType, traceRequestType);
}

export function parseOtlpLogs(
  body: ArrayBuffer,
  contentType?: string | null,
): OtlpParseResult<IExportLogsServiceRequest> {
  if (body.byteLength === 0) {
    return { ok: true, request: { resourceLogs: [] } };
  }
  return parseWithFallback<IExportLogsServiceRequest>(body, contentType, logRequestType);
}

export function parseOtlpMetrics(
  body: ArrayBuffer,
  contentType?: string | null,
): OtlpParseResult<IExportMetricsServiceRequest> {
  if (body.byteLength === 0) {
    return { ok: true, request: { resourceMetrics: [] } };
  }
  return parseWithFallback<IExportMetricsServiceRequest>(body, contentType, metricsRequestType);
}

function parseWithFallback<T>(
  body: ArrayBuffer,
  contentType: string | null | undefined,
  protoType: {
    decode: (buf: Uint8Array) => T;
    encode: (msg: T) => { finish: () => Uint8Array };
  },
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
    // JSON-then-protobuf-encode fallback (mirrors hardened /v1/traces path):
    // some clients send JSON without Content-Type, or protobuf-shaped bytes
    // with `application/json`. Re-encoding validates structure and
    // normalises wire-format quirks before downstream consumers see it.
    try {
      const json = JSON.parse(Buffer.from(body).toString("utf-8")) as T;
      request = protoType.decode(new Uint8Array(protoType.encode(json).finish()));
      return { ok: true, request };
    } catch (jsonErr) {
      // The size is context for the numbers printed beside it, not a verdict of
      // its own: `index out of range: 57 + 1307648 > 2070` only means something
      // against how much actually arrived, and a JSON position says little
      // without the end it stopped short of. It is also the one fact about the
      // body we can state without quoting a byte of it.
      return {
        ok: false,
        error: (
          `Failed to parse OTLP body (${body.byteLength} bytes): ` +
          `${describeParseFailure(firstErr)}` +
          ` (json fallback: ${describeParseFailure(jsonErr)})`
        ).slice(0, MAX_FAILURE_MESSAGE),
      };
    }
  }
}

/** Long enough to keep a decoder's structural detail, short enough to log. */
const MAX_FAILURE_DETAIL = 120;

/**
 * Bounded here rather than left to add up from the parts: two details and a
 * byte count already sum close to this, so the guarantee is stated once
 * instead of re-derived whenever a piece changes width.
 */
const MAX_FAILURE_MESSAGE = 300;

/**
 * A parser's error message, reduced to what is safe to repeat. JSON failures
 * are rebuilt (fixed phrasing + position) since SyntaxError used to leak body
 * bytes into logs; protobuf failures keep their own structural-only words.
 */
function describeParseFailure(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);

  if (err instanceof SyntaxError || /is not valid JSON/.test(message)) {
    return describeJsonFailure(message);
  }

  return message
    .replace(/"(?:[^"\\]|\\.)*"/g, '"…"')
    .replace(/'(?:[^'\\]|\\.)*'/g, "'…'")
    .replace(/`(?:[^`\\]|\\.)*`/g, "`…`")
    .replace(/[^\x20-\x7e]/g, "")
    .trim()
    .slice(0, MAX_FAILURE_DETAIL);
}

/**
 * Built from the parser's verdict, never from its quotation of the input.
 * The position is the one detail worth keeping: it says how far into the body
 * the sender got before the bytes stopped making sense.
 */
function describeJsonFailure(message: string): string {
  if (/Unexpected end of JSON input/.test(message)) {
    return "invalid JSON: unexpected end of input";
  }

  const position = /position (\d+)/.exec(message)?.[1];
  return position ? `invalid JSON at position ${position}` : "invalid JSON: unexpected token";
}

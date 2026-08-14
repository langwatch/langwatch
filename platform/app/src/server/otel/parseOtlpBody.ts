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

import { promisify } from "node:util";
import { brotliDecompress, gunzip, inflate } from "node:zlib";
import type {
  IExportLogsServiceRequest,
  IExportMetricsServiceRequest,
  IExportTraceServiceRequest,
} from "@opentelemetry/otlp-transformer";
import * as root from "@opentelemetry/otlp-transformer/build/src/generated/root";
import {
  OtlpBodyTooLargeError,
  OtlpBodyUnreadableError,
  OtlpUnsupportedEncodingError,
} from "./errors";

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
 * The most we will read off the wire, and the most we will hold after
 * decompressing.
 *
 * One number covers both because they bound the same thing — the bytes this
 * process ends up holding for one request — and neither stage can express the
 * other. `bodyLimit` weighs the bytes on the wire, and the ratio between those
 * and the bytes in memory is chosen by the sender: a 10 MiB gzip of repetitive
 * protobuf expands by orders of magnitude. An uncompressed body has no such
 * ratio, but it is read whole before any of that, so a route with no wire limit
 * is exposed to the plain version of the same attack.
 *
 * Both caps live here rather than at each route because the routes do not agree
 * on middleware: the OTLP handler routes carry `bodyLimit`, and the governance
 * ingest routes carry none at all, which made them the more exposed of the two
 * receivers. Applying the bound in the one function both receivers share means
 * neither can be left out, and each still answers in its own contract — the
 * OTLP routes with a 413, the ingest routes with their existing ack-and-hint.
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

type Decompressor = (
  buf: Buffer,
  opts: { maxOutputLength: number },
) => Promise<Buffer>;

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
 * Release the reader without letting it throw.
 *
 * A reader whose stream was torn down mid-read can throw from `releaseLock()`
 * itself, and thrown from a `finally` block that error REPLACES the one already
 * on its way out. That is how a client disconnect came to be reported as an
 * unrelated stream-internals TypeError, and — being unclassified — answered
 * 500. Nothing here is worth reporting: the stream is already gone, and the
 * failure that matters has been raised.
 */
function releaseQuietly(reader: { releaseLock: () => void }): void {
  try {
    reader.releaseLock();
  } catch {
    // Deliberately swallowed; see above.
  }
}

/** Same reasoning as {@link releaseQuietly}, for the over-size cancel path. */
async function cancelQuietly(reader: {
  cancel: () => Promise<void>;
}): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    // The refusal we are about to throw is the diagnosis, not this.
  }
}

/**
 * Read the wire body, refusing it the moment it passes
 * {@link OTLP_MAX_BODY_BYTES}.
 *
 * Consuming the stream by hand rather than calling `req.arrayBuffer()` is the
 * point: `arrayBuffer()` buffers the whole body and only then hands it over, so
 * measuring afterwards would concede exactly the memory being defended.
 *
 * Every way this can fail is the sender's: the body was already consumed, the
 * connection ended mid-read, or it passed the size bound. None of them is a
 * server fault, and leaving them unclassified is what had them answered 500.
 */
/**
 * "Body is unusable" — the body was already consumed, or another reader holds
 * the lock. Nothing can be read, and it is not a server fault.
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
async function drainWithinLimit(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<Buffer> {
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
 * Read the request body, decompressing per `Content-Encoding`.
 *
 * Throws on unsupported encodings, and on a body that passes
 * {@link OTLP_MAX_BODY_BYTES} either on the wire or on expanding — the caller
 * decides how to respond. Decompression is bounded by zlib itself, so an
 * oversized body stops being written the moment it crosses the line.
 */
export async function readOtlpBody(req: Request): Promise<ArrayBuffer> {
  const encoding = req.headers.get("content-encoding");

  if (!encoding || encoding === "identity") {
    return toArrayBuffer(await readWireBody(req));
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
  const raw = await readWireBody(req);

  try {
    return toArrayBuffer(
      await decompress(raw, { maxOutputLength: OTLP_MAX_BODY_BYTES }),
    );
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
        error:
          `Failed to parse OTLP body: ${describeParseFailure(firstErr)}` +
          ` (json fallback: ${describeParseFailure(jsonErr)})`,
      };
    }
  }
}

/** Long enough to keep a decoder's structural detail, short enough to log. */
const MAX_FAILURE_DETAIL = 120;

/**
 * A parser's error message, reduced to the part that is ours to repeat.
 *
 * Nothing here logs the request body — and the body reached the log sink
 * anyway, because V8's `JSON.parse` SyntaxError quotes about ten characters of
 * its input inside the message and we passed that message straight through.
 * Those characters are arbitrary bytes, so they were routinely not valid UTF-8,
 * which broke consumers that parse a log record's own metadata.
 *
 * A JSON failure is therefore rebuilt rather than filtered: only a fixed phrase
 * and, where the parser gives one, a numeric position. Nothing from the input
 * can survive a construction that never reads it.
 *
 * A protobuf failure keeps its own words, because "index out of range: 57 +
 * 1307648 > 2070" is the sentence that says whether the sender truncated the
 * body or we mis-read it — and protobufjs describes structure, never content.
 * It is still stripped of quoted spans and anything unprintable, so a future
 * decoder that starts echoing bytes cannot reopen this.
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
  return position
    ? `invalid JSON at position ${position}`
    : "invalid JSON: unexpected token";
}

import { randomUUID } from "node:crypto";

import type { Logger } from "@langwatch/observability";

import { MAX_BLOB_BYTES } from "./blobConstants.ts";
import {
  type CompressionCodec,
  compress,
  compressionMediaType,
  contentHashSource,
  decodePayload,
  decompress,
  encodePayload,
} from "./bodyCodec.ts";
import { errorText as errText, safeParseErrorText as safeParseErrText } from "./errors.ts";
import { gqPayloadTooLargeTotal } from "./metrics.ts";
import type { TenantId } from "./storage.ts";
import type { BlobRef, TieredBlobStore } from "./tieredBlobStore.ts";

/**
 * zlib reports an over-limit result as ERR_BUFFER_TOO_LARGE (or an "output
 * length" RangeError depending on version) — both mean the same thing: park
 * for inspection via {@link PayloadTooLargeError} rather than drop to replay.
 */
async function boundedDecompress(data: Buffer): Promise<Buffer> {
  try {
    return await decompress(data);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (
      code === "ERR_BUFFER_TOO_LARGE" ||
      (err instanceof RangeError && /output length/i.test(err.message))
    ) {
      throw new PayloadTooLargeError(MAX_BLOB_BYTES + 1);
    }
    throw err;
  }
}

/**
 * Named `decode*`, not `read*` (which never throws): failures throw
 * `DecodeFailureError` reason `body_unreadable`, distinct from a gone blob —
 * an old worker meeting a new one's body must let the next worker retry it.
 */
async function decodeBody(data: Buffer): Promise<Record<string, unknown>> {
  let inflated: Buffer;
  try {
    inflated = await boundedDecompress(data);
  } catch (err) {
    if (err instanceof PayloadTooLargeError) throw err;
    throw new DecodeFailureError({
      message: `Job envelope body failed to decompress: ${errText(err)}`,
      reason: "body_unreadable",
    });
  }
  try {
    return decodePayload(inflated);
  } catch (err) {
    throw new DecodeFailureError({
      message: `Job envelope body failed to parse: ${safeParseErrText(err)}`,
      reason: "body_unreadable",
    });
  }
}

/** Inline uncompressed body — named the same way {@link decodeBody} names a blob body. */
function parseInlineBody(body: string): Record<string, unknown> {
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch (err) {
    throw new DecodeFailureError({
      message: `Job envelope inline body failed to parse: ${safeParseErrText(err)}`,
      reason: "body_unreadable",
    });
  }
}

/**
 * Decode-side twin of {@link assertPayloadWithinCap}: a synchronous parse of
 * a runaway value seizes the worker event loop, which the liveness probe
 * converts into a process-wide crash loop.
 */
function assertDecodeWithinCap(byteLength: number): void {
  if (byteLength > MAX_BLOB_BYTES) {
    throw new PayloadTooLargeError(byteLength);
  }
}

/**
 * Canonical envelope for staged job values: `GQ2|<headerLen>|<headerJson><body>`.
 * The header carries routing + encoding for Lua/dashboard without touching the
 * body; bodies above {@link INLINE_CEILING_BYTES} move to {@link TieredBlobStore}.
 */
const ENVELOPE_PREFIX_V2 = "GQ2|";
/** The prefix is four ASCII bytes. */
const ENVELOPE_PREFIX_LEN = 4;

/** gzip+base64 of sub-kilobyte JSON is frequently larger than the input. */
const COMPRESSION_THRESHOLD_BYTES = 1024;

/**
 * Above this, the body moves to the content-addressed tiered store.
 */
const INLINE_CEILING_BYTES = 4 * 1024;

/** Storage for content-addressed Redis bodies with a renewable TTL. */
export interface JobBlobStore {
  /** `ttlSeconds` overrides the default backstop. */
  put(params: { id: string; data: Buffer; ttlSeconds?: number }): Promise<void>;
  /** Read the blob AND refresh its backstop TTL. Worker hot path only. */
  get(params: { id: string; ttlSeconds?: number }): Promise<Buffer | null>;
  /** Read the blob WITHOUT refreshing its TTL. Non-worker / ops-dashboard inspection path. */
  peek(params: { id: string }): Promise<Buffer | null>;
  delete(params: { id: string }): Promise<void>;
}

export interface JobRoutingMeta {
  pipelineName: string | null;
  jobType: string | null;
  jobName: string | null;
}

type BodyEncoding = "j" | "gz" | "redis" | "s3";

export interface EnvelopeHeader {
  v: number;
  e: BodyEncoding;
  /** Content-addressed tiered blob reference. */
  ref?: BlobRef;
  /** GQ2 per-stage lease holder identity for this staged occupancy. */
  h?: string;
  /**
   * Payload size in bytes BEFORE compression/offload (ADR-066 pillar 2) — the
   * stored value's own length lies once a body is compressed or offloaded, and
   * the drain's byte budget reads this field so its bound survives offload.
   */
  s?: number;
  /** Routing fields read by the Lua dispatcher and ops dashboard WITHOUT parsing the body. */
  p?: string;
  t?: string;
  n?: string;
  /**
   * GQ2: queue-machinery fields (every `__*` key) lifted out so they don't
   * perturb the content hash — the same event fanned out to N subscribers then
   * collapses to one stored blob (ADR-029). Allowlist-free: any `__*` is machinery.
   */
  m?: Record<string, unknown>;
}

/**
 * GQ2: split jobData into (machinery, payload). Every `__*` key is queue
 * machinery that would perturb the body bytes if left in, defeating
 * content-addressed dedup; the user payload is the rest.
 */
function splitMachineryFromBody(jobData: Record<string, unknown>): {
  machinery: Record<string, unknown>;
  payload: Record<string, unknown>;
} {
  const machinery: Record<string, unknown> = {};
  const payload: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(jobData)) {
    if (k.startsWith("__")) {
      machinery[k] = v;
    } else {
      payload[k] = v;
    }
  }
  return { machinery, payload };
}

/**
 * GQ2 decode side of {@link splitMachineryFromBody}. The routing trio lives
 * in `header.p/t/n` only — the fast path `readJobRoutingMeta` reads without
 * touching the body — while the rest of the machinery lives in `header.m`.
 */
function mergeMachinery(
  body: Record<string, unknown>,
  header: EnvelopeHeader,
): Record<string, unknown> {
  const hasRouting =
    typeof header.p === "string" || typeof header.t === "string" || typeof header.n === "string";
  if (!header.m && !hasRouting) return body;
  const merged: Record<string, unknown> = { ...body, ...header.m };
  if (typeof header.p === "string") merged.__pipelineName = header.p;
  if (typeof header.t === "string") merged.__jobType = header.t;
  if (typeof header.n === "string") merged.__jobName = header.n;
  return merged;
}

function routingHeader(jobData: Record<string, unknown>, version: number): EnvelopeHeader {
  const header: EnvelopeHeader = { v: version, e: "j" };
  if (typeof jobData.__pipelineName === "string") header.p = jobData.__pipelineName;
  if (typeof jobData.__jobType === "string") header.t = jobData.__jobType;
  if (typeof jobData.__jobName === "string") header.n = jobData.__jobName;
  return header;
}

function finalize(prefix: string, header: EnvelopeHeader, body: string): string {
  const headerJson = JSON.stringify(header);
  // Header length is in BYTES: the Lua reader slices bytes, and UTF-16 code
  // units diverge from bytes if a routing field carries non-ASCII.
  return `${prefix}${Buffer.byteLength(headerJson)}|${headerJson}${body}`;
}

/**
 * Picks the inline encoding: raw JSON, or compressed+base64 when compression
 * wins (mutates `header.e` to `"gz"`). The codec itself is sniffed from magic
 * bytes on decode, not named in the header, so header and bytes can't disagree.
 */
async function inlineBody({
  json,
  jsonBytes,
  header,
  compression,
}: {
  json: string;
  jsonBytes: number;
  header: EnvelopeHeader;
  compression: CompressionCodec;
}): Promise<string> {
  if (jsonBytes > COMPRESSION_THRESHOLD_BYTES) {
    const compressed = (await compress(json, compression)).toString("base64");
    // High-entropy payloads (inline base64-ish data) can come out LARGER after
    // compress+base64; keep raw JSON unless compression actually wins. `"gz"`
    // costs one more header byte than `"j"`.
    if (Buffer.byteLength(compressed) + 1 < jsonBytes) {
      header.e = "gz";
      return compressed;
    }
  }
  return json;
}

/**
 * Thrown when a job's serialized payload exceeds {@link MAX_BLOB_BYTES}. Rejecting
 * at encode keeps a pathological payload from OOMing the worker on gzip + buffer.
 */
export class PayloadTooLargeError extends Error {
  readonly byteLength: number;
  constructor(byteLength: number) {
    super(`Job payload is ${byteLength} bytes, over the ${MAX_BLOB_BYTES}-byte ceiling`);
    this.name = "PayloadTooLargeError";
    this.byteLength = byteLength;
  }
}

/**
 * A closed set derived from the failure TYPE, not message text (zlib's wording
 * is Node-version-dependent). `missing_blob` is irreducible loss; the other two
 * are body-PRESENT (a rolling-deploy skew) and must never be retired.
 */
export type DecodeFailureReason = "missing_blob" | "malformed_envelope" | "body_unreadable";

/**
 * Distinct from {@link PayloadTooLargeError} (park) and `TransientBlobStoreError`
 * (retry — not gone). Carries only `reason`; a plain `Error` still gets a
 * descriptor, read from the value itself.
 */
export class DecodeFailureError extends Error {
  readonly reason: DecodeFailureReason;
  constructor({ message, reason }: { message: string; reason: DecodeFailureReason }) {
    super(message);
    this.name = "DecodeFailureError";
    this.reason = reason;
  }
}

/** A drop-log-safe description of an envelope: shape only, never body or PII. */
export interface EnvelopeDescriptor {
  /** Body encoding — "redis" | "s3" | "gz" | "j" (wire: `header.e`). */
  format: string | null;
  /** Envelope version (wire: `header.v`). */
  version: number | null;
  /** Content hash for an offloaded body. */
  blobId: string | null;
}

/**
 * Never throws; unreadable envelopes yield nulls (shape only — never PII).
 * Only a string that LOOKS like a blob id passes (#5538): base64url, not hex
 * — an earlier hex-only guard broke real ids; keep this pattern.
 */
const safeBlobId = (id: string | null): string | null =>
  id && /^[A-Za-z0-9_-]{8,128}$/.test(id) ? id : null;

export function readEnvelopeDescriptor(value: string): EnvelopeDescriptor {
  try {
    if (!isEnvelope(value)) {
      return { format: null, version: null, blobId: null };
    }
    const { header } = splitEnvelope(value);
    return {
      format: typeof header.e === "string" ? header.e : null,
      version: typeof header.v === "number" ? header.v : null,
      blobId: safeBlobId(header.ref?.hash ?? null),
    };
  } catch {
    return { format: null, version: null, blobId: null };
  }
}

/** Guards the payload-size ceiling (ADR-026). Emits a tenant-attributed warn before rejecting. */
export function assertPayloadWithinCap(
  jsonBytes: number,
  ctx?: { projectId?: TenantId; queueName?: string; logger?: Logger },
): void {
  if (jsonBytes > MAX_BLOB_BYTES) {
    if (ctx?.logger) {
      ctx.logger.warn(
        {
          projectId: ctx.projectId,
          byteLength: jsonBytes,
          cap: MAX_BLOB_BYTES,
        },
        "Job payload over MAX_BLOB_BYTES — rejecting at encode",
      );
    }
    if (ctx?.queueName) {
      gqPayloadTooLargeTotal.inc({ queue_name: ctx.queueName });
    }
    throw new PayloadTooLargeError(jsonBytes);
  }
}

export async function encodeJobEnvelope({
  jobData,
  tieredBlobs,
  projectId,
  compression = "gzip",
  payloadCodec = "json",
  queueName,
  logger,
}: {
  jobData: Record<string, unknown>;
  tieredBlobs?: TieredBlobStore;
  projectId?: TenantId;
  compression?: CompressionCodec;
  payloadCodec?: "json" | "msgpack";
  /** Optional queue name for observability labels. */
  queueName?: string;
  /** Optional logger for tenant-attributed size warnings. */
  logger?: Logger;
}): Promise<string> {
  const header = routingHeader(jobData, 2);
  const { machinery, payload } = splitMachineryFromBody(jobData);
  delete machinery.__pipelineName;
  delete machinery.__jobType;
  delete machinery.__jobName;
  if (Object.keys(machinery).length > 0) header.m = machinery;

  const {
    bytes,
    codec,
    json: payloadJson,
  } = encodePayload(payload, {
    msgpackEnabled: payloadCodec === "msgpack",
  });
  const payloadBytes = bytes.length;
  assertPayloadWithinCap(payloadBytes, { projectId, queueName, logger });
  header.s = payloadBytes;

  if (payloadBytes > INLINE_CEILING_BYTES) {
    if (!tieredBlobs || !projectId) {
      throw new Error(
        "Group Queue needs a tenant id and tiered blob storage for an offloaded payload",
      );
    }
    const ref = await tieredBlobs.put({
      projectId,
      data: await compress(bytes, compression),
      hashSource: contentHashSource({ codec, json: payloadJson, bytes }),
      mediaType: compressionMediaType(compression),
    });
    header.e = ref.tier;
    header.ref = ref;
    header.h = randomUUID();
    return finalize(ENVELOPE_PREFIX_V2, header, "");
  }

  return finalize(
    ENVELOPE_PREFIX_V2,
    header,
    await inlineBody({
      json: payloadJson ?? bytes.toString("utf-8"),
      jsonBytes: payloadBytes,
      header,
      compression,
    }),
  );
}

export async function decodeJobEnvelope({
  value,
  tieredBlobs,
  readMode = "get",
  parsed,
}: {
  value: string;
  tieredBlobs?: TieredBlobStore;
  /**
   * `"get"` = worker hot path, refreshes the blob's backstop TTL. `"peek"` =
   * non-worker inspection (ops dashboard), does NOT refresh — so a repeatedly-
   * viewed blocked group can't keep its orphan blobs alive.
   */
  readMode?: "get" | "peek";
  /** Pre-parsed (header, body) tuple from {@link splitEnvelope}, so callers that
   * have already parsed the envelope (e.g. `EnvelopeBlobLifecycle.decode`) don't
   * pay for a second `Buffer.from` + `JSON.parse` on the hot path. */
  parsed?: { header: EnvelopeHeader; body: string };
}): Promise<Record<string, unknown>> {
  if (!isEnvelope(value)) {
    throw new DecodeFailureError({
      message: "Unsupported Group Queue value: expected a version 2 envelope",
      reason: "malformed_envelope",
    });
  }

  const { header, body } = parsed ?? splitEnvelope(value);

  // GQ2: content-addressed tiered blob.
  if (header.e === "redis" || header.e === "s3") {
    if (!header.ref) {
      throw new DecodeFailureError({
        message: "Malformed job envelope: tiered body without a blob ref",
        reason: "malformed_envelope",
      });
    }
    if (!tieredBlobs) {
      throw new Error("Job envelope references a tiered blob but no tiered store was provided");
    }
    const data =
      readMode === "peek" ? await tieredBlobs.peek(header.ref) : await tieredBlobs.get(header.ref);
    if (!data) {
      throw new DecodeFailureError({
        message: "Job envelope tiered blob is missing (deleted or expired)",
        reason: "missing_blob",
      });
    }
    const parsedBody = await decodeBody(data);
    return mergeMachinery(parsedBody, header);
  }

  // Raw inline bodies never went through the bounded decompressor, so cap them
  // before the synchronous parse; compressed bodies are bounded by
  // boundedDecompress itself.
  if (header.e !== "gz") {
    assertDecodeWithinCap(Buffer.byteLength(body, "utf8"));
  }
  const parsedBody =
    header.e === "gz" ? await decodeBody(Buffer.from(body, "base64")) : parseInlineBody(body);
  return mergeMachinery(parsedBody, header);
}

/**
 * Reads routing fields from the envelope header. Never throws.
 */
export function readJobRoutingMeta(value: string): JobRoutingMeta {
  try {
    if (!isEnvelope(value)) {
      return { pipelineName: null, jobType: null, jobName: null };
    }
    const { header } = splitEnvelope(value);
    return {
      pipelineName: typeof header.p === "string" ? header.p : null,
      jobType: typeof header.t === "string" ? header.t : null,
      jobName: typeof header.n === "string" ? header.n : null,
    };
  } catch {
    return { pipelineName: null, jobType: null, jobName: null };
  }
}

/**
 * Byte cost for a value that hasn't been decoded — see ADR-069 for the
 * three-case algorithm. Has a Lua twin (`gqPayloadSize` in `scripts.ts`):
 * an envelope-format change must land in both.
 */
export function readJobPayloadBytes(value: string): number {
  try {
    if (isEnvelope(value)) {
      const { header } = splitEnvelope(value);
      if (Number.isSafeInteger(header.s) && (header.s as number) >= 0) {
        return header.s as number;
      }
      // No usable `s`: only a plain inline body is worth its stored length.
      if (header.e !== "j") return MAX_BLOB_BYTES;
    }
  } catch {
    return Buffer.byteLength(value, "utf8");
  }
  return Buffer.byteLength(value, "utf8");
}

/**
 * Never throws; an absent or unreadable attempt is null. Lives ON THE HEADER
 * so the retry ladder can read it with no blob I/O, even when the blob store
 * is temporarily unreachable and nothing else about the job is legible.
 */
export function readJobAttempt(value: string): number | null {
  try {
    if (!isEnvelope(value)) return null;
    const machinery = (splitEnvelope(value).header.m ?? {}) as Record<string, unknown>;
    const attempt = machinery.__attempt;
    // Reported verbatim: this is a reader, and one that silently reshapes what
    // is stored cannot be used to check what was written. `__attempt` is lifted
    // out of the payload by name, so a job whose payload carried that key could
    // name a number past the budget — the ladder then treats it as already
    // spent and retires the job, which is the fail-closed direction.
    return typeof attempt === "number" && Number.isInteger(attempt) && attempt > 0 ? attempt : null;
  } catch {
    return null;
  }
}

/**
 * Rewrites the HEADER ONLY; the body is reused byte for byte, since it's what
 * the blob store content-addresses — re-encoding it would split a shared
 * copy and churn the lease identity. Unsupported values return unchanged.
 */
export function withJobAttempt({ value, attempt }: { value: string; attempt: number }): string {
  if (!value.startsWith(ENVELOPE_PREFIX_V2)) return value;
  try {
    const { header, body } = splitEnvelope(value);
    return finalize(
      ENVELOPE_PREFIX_V2,
      { ...header, m: { ...header.m, __attempt: attempt } },
      body,
    );
  } catch {
    return value;
  }
}

/**
 * Header-taking variant of {@link readEnvelopeLease} — for callers that have
 * already parsed the envelope and don't want a second `Buffer.from + JSON.parse`.
 */
export function readEnvelopeLeaseFromHeader(
  header: EnvelopeHeader,
): { ref: BlobRef; holderId: string } | null {
  if ((header.e === "redis" || header.e === "s3") && header.ref && typeof header.h === "string") {
    return { ref: header.ref, holderId: header.h };
  }
  return null;
}

/**
 * The tenant guard MUST key off this, not {@link readEnvelopeLeaseFromHeader}
 * — that also requires `header.h`, so a cross-tenant `ref` with no holder id
 * would skip the guard yet still be fetched. Lease is for renewal only (ADR-029).
 */
export function readEnvelopeTieredRefFromHeader(header: EnvelopeHeader): BlobRef | null {
  if ((header.e === "redis" || header.e === "s3") && header.ref) {
    return header.ref;
  }
  return null;
}

/**
 * Returns the ref together with its per-stage lease holder identity, or null
 * for inline bodies and unreadable values.
 */
export function readEnvelopeLease(value: string): { ref: BlobRef; holderId: string } | null {
  try {
    if (!isEnvelope(value)) return null;
    const { header } = splitEnvelope(value);
    return readEnvelopeLeaseFromHeader(header);
  } catch {
    return null;
  }
}

/**
 * Single parse for retirement: given a staged value, return its lease.
 */
export function readEnvelopeRetirement(value: string): {
  lease: { ref: BlobRef; holderId: string } | null;
} {
  try {
    if (!isEnvelope(value)) return { lease: null };
    const { header } = splitEnvelope(value);
    return {
      lease: readEnvelopeLeaseFromHeader(header),
    };
  } catch {
    return { lease: null };
  }
}

export function isEnvelope(value: string): boolean {
  return value.startsWith(ENVELOPE_PREFIX_V2);
}

export function splitEnvelope(value: string): {
  header: EnvelopeHeader;
  body: string;
} {
  const lenEnd = value.indexOf("|", ENVELOPE_PREFIX_LEN);
  if (lenEnd === -1) {
    throw new DecodeFailureError({
      message: "Malformed job envelope: missing header length delimiter",
      reason: "malformed_envelope",
    });
  }
  const lenDigits = value.slice(ENVELOPE_PREFIX_LEN, lenEnd);
  if (!/^\d+$/.test(lenDigits)) {
    throw new DecodeFailureError({
      message: "Malformed job envelope: invalid header length",
      reason: "malformed_envelope",
    });
  }
  const headerLen = Number(lenDigits);
  if (headerLen <= 0) {
    throw new DecodeFailureError({
      message: "Malformed job envelope: invalid header length",
      reason: "malformed_envelope",
    });
  }
  // Prefix and length digits are ASCII, so lenEnd is the same offset in bytes
  // and code units; the header itself must be sliced as bytes to match Lua.
  const buf = Buffer.from(value, "utf8");
  const headerJson = buf.subarray(lenEnd + 1, lenEnd + 1 + headerLen).toString("utf8");
  // Guarded like the body parses: a corrupt header makes V8 echo raw bytes
  // back, and the header carries `m.__context` (traceId/userId/projectId)
  // that would reach the drop log via the raw-Error path (strips only
  // storage URIs). Also makes this `malformed_envelope`, not `unknown` (#5538).
  let header: EnvelopeHeader;
  try {
    header = JSON.parse(headerJson) as EnvelopeHeader;
  } catch (err) {
    throw new DecodeFailureError({
      message: `Malformed job envelope: header failed to parse: ${safeParseErrText(err)}`,
      reason: "malformed_envelope",
    });
  }
  if (header.v !== 2 || !["j", "gz", "redis", "s3"].includes(header.e)) {
    throw new DecodeFailureError({
      message: "Malformed job envelope: unsupported version or body encoding",
      reason: "malformed_envelope",
    });
  }
  return {
    header,
    body: buf.subarray(lenEnd + 1 + headerLen).toString("utf8"),
  };
}

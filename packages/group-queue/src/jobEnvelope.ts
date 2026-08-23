import { randomUUID } from "node:crypto";

import type { Logger } from "@langwatch/observability";

import {
  errorText as errText,
  safeParseErrorText as safeParseErrText,
} from "./errors";
import { MAX_BLOB_BYTES } from "./blobConstants";
import {
  type CompressionCodec,
  compress,
  compressionMediaType,
  contentHashSource,
  decodePayload,
  decompress,
  encodePayload,
} from "./bodyCodec";
import { gqPayloadTooLargeTotal } from "./metrics";
import type { BlobRef, TieredBlobStore } from "./tieredBlobStore";
import type { TenantId } from "./storage";

/**
 * Decompression with the over-limit error converted to a park signal. bodyCodec
 * already caps both codecs' output at the encode ceiling (ADR-026) so a
 * tampered or corrupt blob (e.g. a tenant zip-bombing their own BYOC object)
 * can't OOM the worker; zlib reports the over-limit result as
 * ERR_BUFFER_TOO_LARGE (or an "output length" RangeError depending on version).
 * Both mean the same thing here: the staged value would materialize past the
 * decode ceiling, so throw {@link PayloadTooLargeError} and let the caller park
 * the group for inspection instead of dropping the job to replay (which would
 * re-materialize the same value).
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
 * Inflate + parse a body, naming the failure if it will not read.
 *
 * Named `decode*`, not `read*`: every `read*` in this file contractually never
 * throws (`readJobRoutingMeta`, `readEnvelopeDescriptor`, `readEnvelopeLease`…),
 * and this throws the `DecodeFailureError`s the drop path dispatches on.
 *
 * A body that is present but unreadable — bad compression frame, a codec this
 * worker does not know, a parse that fails — is NOT the same event as a blob that
 * is gone, and this is the exact rolling-deploy vector described at the top of
 * this file: an old worker meeting a body written by a new one. Naming it
 * `body_unreadable` is what lets the caller keep the value instead of retiring
 * it, so the next worker can read what this one could not.
 *
 * {@link PayloadTooLargeError} passes through untouched — that is the park signal,
 * and an oversized body must keep parking rather than be recast as corrupt.
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
 * Decode-side twin of {@link assertPayloadWithinCap}: an invalid persisted
 * value must not reach JSON.parse unbounded. A synchronous parse of a runaway
 * value seizes the worker event loop, which the liveness probe converts into a
 * process-wide crash loop.
 */
function assertDecodeWithinCap(byteLength: number): void {
  if (byteLength > MAX_BLOB_BYTES) {
    throw new PayloadTooLargeError(byteLength);
  }
}

/**
 * Canonical envelope for staged job values: `GQ2|<headerLen>|<headerJson><body>`.
 *
 * The header carries only what dispatch-time Lua and the ops dashboard need
 * without touching the body (routing fields + body encoding). The body is the
 * full payload JSON: raw or gzip+base64 inline when it stays in the envelope,
 * or empty when offloaded to a standalone blob whose reference the header
 * carries.
 *
 * Bodies above 4 KiB use a content-addressed, tenant-namespaced blob through
 * {@link TieredBlobStore}; smaller bodies remain inline. Values outside this
 * format are rejected at the persisted-data boundary.
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
   * Serialized payload size in bytes, BEFORE compression and before any offload
   * to the blob store — the size the payload has once it is back in a worker's
   * hands (ADR-066 pillar 2).
   *
   * It exists because the stored value's own length answers a different
   * question. A body over {@link INLINE_CEILING_BYTES} leaves only a reference
   * behind, and a body over {@link COMPRESSION_THRESHOLD_BYTES} is stored
   * compressed, so `#value` can be two or three orders of magnitude under the
   * bytes a coalesced batch will actually hold in memory and append downstream.
   * The drain's byte budget reads this field, so its bound survives offload.
   *
   * In the header, never the body: the body is content-addressed and hashing it
   * with a size field would be harmless but redundant, while the header is what
   * both the Lua drain and the ops dashboard can read without blob I/O.
   */
  s?: number;
  /** Routing fields read by the Lua dispatcher and ops dashboard WITHOUT parsing the body. */
  p?: string;
  t?: string;
  n?: string;
  /**
   * GQ2: queue-machinery fields (every `__*` key in jobData) lifted out of the
   * body so they don't perturb the content hash. Restored onto the parsed body
   * on decode. The user payload is everything else; the body is hashed over
   * the payload alone, so the same event fanned out to N subscribers collapses to
   * one stored blob (ADR-029). Allowlist-free: any future `__*` field is
   * automatically treated as machinery.
   */
  m?: Record<string, unknown>;
}

/**
 * GQ2: split jobData into (machinery, payload). Every `__*` key is queue
 * machinery — the queue assigns these fields per-stage (`__stagedJobId`,
 * `__attempt`, `__context`) or per-subscriber (`__jobName`, `__jobType`,
 * `__pipelineName`), and they perturb the body bytes if left in, defeating
 * content-addressed dedup. The user payload is the rest.
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
 * GQ2 decode side of {@link splitMachineryFromBody}: re-merge the queue
 * machinery back onto the parsed body. The routing trio
 * (`__pipelineName/__jobType/__jobName`) lives in `header.p/t/n` only — the
 * read-fast-path used by the Lua dispatcher and `readJobRoutingMeta` without
 * touching the body. The rest of the machinery lives in `header.m`. Keeping
 * the trio out of `m` saves ~50 wire bytes per envelope and removes a second
 * source of truth that could drift.
 */
function mergeMachinery(
  body: Record<string, unknown>,
  header: EnvelopeHeader,
): Record<string, unknown> {
  const hasRouting =
    typeof header.p === "string" ||
    typeof header.t === "string" ||
    typeof header.n === "string";
  if (!header.m && !hasRouting) return body;
  const merged: Record<string, unknown> = { ...body, ...(header.m ?? {}) };
  if (typeof header.p === "string") merged.__pipelineName = header.p;
  if (typeof header.t === "string") merged.__jobType = header.t;
  if (typeof header.n === "string") merged.__jobName = header.n;
  return merged;
}

function routingHeader(
  jobData: Record<string, unknown>,
  version: number,
): EnvelopeHeader {
  const header: EnvelopeHeader = { v: version, e: "j" };
  if (typeof jobData.__pipelineName === "string")
    header.p = jobData.__pipelineName;
  if (typeof jobData.__jobType === "string") header.t = jobData.__jobType;
  if (typeof jobData.__jobName === "string") header.n = jobData.__jobName;
  return header;
}

function finalize(
  prefix: string,
  header: EnvelopeHeader,
  body: string,
): string {
  const headerJson = JSON.stringify(header);
  // Header length is in BYTES: the Lua reader slices bytes, and UTF-16 code
  // units diverge from bytes if a routing field carries non-ASCII.
  return `${prefix}${Buffer.byteLength(headerJson)}|${headerJson}${body}`;
}

/**
 * Picks the inline encoding for a body that stays in the envelope: raw JSON, or
 * compressed+base64 when compression actually wins (mutates `header.e` to
 * `"gz"`).
 *
 * `"gz"` means "compressed"; the codec itself is sniffed from the magic bytes on
 * decode rather than named in the header, so a zstd body and a gzip body are
 * both `"gz"` and a reader never has to trust a header that could disagree with
 * the bytes it actually got.
 */
async function inlineBody(
  json: string,
  jsonBytes: number,
  header: EnvelopeHeader,
  compression: CompressionCodec,
): Promise<string> {
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
    super(
      `Job payload is ${byteLength} bytes, over the ${MAX_BLOB_BYTES}-byte ceiling`,
    );
    this.name = "PayloadTooLargeError";
    this.byteLength = byteLength;
  }
}

/**
 * Why a decode failed, as a closed set derived from the failure TYPE.
 *
 * Message text is not a classifier: zlib's wording is Node-version-dependent and
 * not ours to own, so an alert built on substring matching breaks under a runtime
 * upgrade. `GroupQueue` labels its drop counter with these, so oncall can separate
 * "the body is gone" from "we cannot read the body we have" without grepping.
 *
 * - `missing_blob` — the envelope's blob resolved to nothing. The body is GONE:
 *   no retry, park, or replay resurrects it. Irreducible loss at this layer.
 * - `malformed_envelope` — the envelope's own structure is unreadable, so we
 *   cannot even find the body.
 * - `body_unreadable` — we found the body and could not turn it back into an
 *   object: a bad compression frame, a codec this worker does not know, or a
 *   parse that failed. One name for all three because they are one event
 *   operationally (these bytes are unreadable *to this worker*) with one fix
 *   (do not retire them). Named for the CONDITION, not one of its mechanisms —
 *   it also fires on an inline, never-compressed body, where nothing was
 *   decompressed at all.
 *
 * `malformed_envelope` and `body_unreadable` are body-PRESENT: the value is
 * intact and a later worker may decode it fine (a rolling-deploy format skew is
 * exactly this — see the codec note at the top of this file). Callers must not
 * retire such a value; see `GroupQueue`'s drop branch.
 */
export type DecodeFailureReason =
  | "missing_blob"
  | "malformed_envelope"
  | "body_unreadable";

/**
 * A decode failure we can name. Distinct from {@link PayloadTooLargeError} (park,
 * do not parse) and `TransientBlobStoreError` (retry — the body is temporarily
 * unreachable, not gone).
 *
 * Carries only `reason`; the envelope descriptor is read from the value itself by
 * {@link readEnvelopeDescriptor}, so throw sites don't thread it and a plain
 * `Error` from anywhere still gets a descriptor.
 */
export class DecodeFailureError extends Error {
  readonly reason: DecodeFailureReason;
  constructor({
    message,
    reason,
  }: {
    message: string;
    reason: DecodeFailureReason;
  }) {
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
 * Describes an envelope for a drop log — format, version, blob id. Never throws;
 * unreadable values yield nulls. Sibling of {@link readJobRoutingMeta}, and the
 * same trick: the header survives what the body does not, so a value we could not
 * decode can still say what it WAS. All-nulls is itself a signal — it means the
 * envelope would not even split.
 *
 * Deliberately shape-only. The body may hold tenant PII; the header holds routing
 * and storage machinery, and blob ids are content hashes.
 */
/**
 * A blob id only if it LOOKS like one. This reader runs on envelopes we already
 * know are malformed, so `header.ref.hash` is an attacker-shaped
 * strings by that point and the value goes straight to a log. Anything off-shape
 * becomes null rather than a free-text field in the drop record (#5538, review).
 *
 * The id is `sha256(bytes).subarray(0,16).toString("base64url")`
 *   (`tieredBlobStore.ts`): 22 chars of `[A-Za-z0-9_-]`. **Not hex** — an earlier
 *   hex-only guard here nulled every legitimate GQ2 id and broke the AC1
 *   descriptor. The unit tests caught it; do not narrow this to hex.
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
    await inlineBody(
      payloadJson ?? bytes.toString("utf-8"),
      payloadBytes,
      header,
      compression,
    ),
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
      throw new Error(
        "Job envelope references a tiered blob but no tiered store was provided",
      );
    }
    const data =
      readMode === "peek"
        ? await tieredBlobs.peek(header.ref)
        : await tieredBlobs.get(header.ref);
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
    header.e === "gz"
      ? await decodeBody(Buffer.from(body, "base64"))
      : parseInlineBody(body);
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
 * How many bytes this job costs a coalesced batch: the header's recorded
 * payload size when the value carries one, and for the values that carry none,
 * whichever reading cannot let the batch overshoot.
 *
 * Three cases, only one of which is a plain measurement:
 *
 * 1. `s` present and a non-negative safe integer — the payload size the encoder
 *    recorded. Exact. Anything else in that field (fractional, `Infinity`,
 *    `NaN`, negative) is not a byte count and is not trusted: a forged or
 *    corrupt header must not be able to talk the budget down, and `Infinity`
 *    would reach the Lua drain as an unparseable ARGV. Those fall through to
 *    the encoding rule below, so an offloaded body still costs the cap.
 * 2. No `s`, body inline and uncompressed (`e:"j"`) — the stored length is a
 *    conservative fallback.
 * 3. No `s`, body compressed or offloaded (`e` of `gz`/`redis`/`s3`, or
 *    absent) — the stored length is a fraction of the payload and there is
 *    nothing in the value that says by how much. Worth {@link MAX_BLOB_BYTES}:
 *    an unreadable payload is treated as the largest payload we accept.
 *
 * Case 3 exists for the length of a rolling deploy: old workers keep staging
 * pre-`s` envelopes while new ones drain them, and a deep backlog is exactly
 * where it does not age out promptly — which is also exactly where the byte
 * bound is load-bearing. Reading the stored length there would reinstate the
 * defect this field was added to close, for the window with the most jobs
 * queued. Costing the cap instead makes such a job drain alone (any sane
 * `coalesceMaxBytes` is far under 50 MiB), so the rollout loses coalescing on
 * those jobs rather than losing the bound. Coalescing is an optimization; the
 * bound is what keeps a worker from assembling a batch it cannot hold.
 *
 * Never throws: a value this cannot parse at all is worth its stored length,
 * not an exception on the drain path.
 *
 * Has a Lua twin: `gqPayloadSize` in `scripts.ts` makes the same three
 * decisions, because the drain spends the byte budget inside Redis while this
 * sets its starting point. An envelope-format change — new prefix, renamed
 * header field, different length-prefix encoding — has to land in both or the
 * two ends of one budget silently disagree.
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
    // Fall through: an unreadable envelope still occupies its stored bytes.
  }
  return Buffer.byteLength(value, "utf8");
}

/**
 * Reads the retry attempt from the envelope header. Never throws; an absent or
 * unreadable attempt is null.
 *
 * This exists so the retry count can live ON THE MESSAGE and still be legible
 * to the one reader that cannot decode a message: when a job's body is held in
 * a blob store that is temporarily unreachable, the ladder that decides whether
 * to retry or give up has nothing but the value in hand. The header is plain
 * inline JSON in front of the body, so it is readable with no blob I/O.
 *
 */
export function readJobAttempt(value: string): number | null {
  try {
    if (!isEnvelope(value)) return null;
    const machinery = (splitEnvelope(value).header.m ?? {}) as Record<
      string,
      unknown
    >;
    const attempt = machinery.__attempt;
    // Reported verbatim: this is a reader, and one that silently reshapes what
    // is stored cannot be used to check what was written. `__attempt` is lifted
    // out of the payload by name, so a job whose payload carried that key could
    // name a number past the budget — the ladder then treats it as already
    // spent and retires the job, which is the fail-closed direction.
    return typeof attempt === "number" &&
      Number.isInteger(attempt) &&
      attempt > 0
      ? attempt
      : null;
  } catch {
    return null;
  }
}

/**
 * The same value with its retry attempt stamped into the header, rewriting the
 * HEADER ONLY.
 *
 * The body string is reused byte for byte, which is the whole point: the body
 * is what the blob store content-addresses and what identical jobs share, so
 * re-encoding it to change a counter would split that shared copy and churn the
 * lease identity. Advancing an attempt is metadata, and costs no blob I/O.
 *
 * Unsupported values are returned unchanged so the caller can report them
 * through the canonical decode-failure path without mutating their bytes.
 */
export function withJobAttempt({
  value,
  attempt,
}: {
  value: string;
  attempt: number;
}): string {
  if (!value.startsWith(ENVELOPE_PREFIX_V2)) return value;
  try {
    const { header, body } = splitEnvelope(value);
    return finalize(
      ENVELOPE_PREFIX_V2,
      { ...header, m: { ...(header.m ?? {}), __attempt: attempt } },
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
  if (
    (header.e === "redis" || header.e === "s3") &&
    header.ref &&
    typeof header.h === "string"
  ) {
    return { ref: header.ref, holderId: header.h };
  }
  return null;
}

/**
 * Every tiered ref the decoder would fetch, whether or not it carries a lease.
 *
 * The tenant guard MUST key off this rather than off {@link readEnvelopeLeaseFromHeader}:
 * that one additionally requires `header.h`, so an envelope with a valid
 * cross-tenant `ref` and no holder id yields no lease, skips the guard, and is
 * still fetched by `decodeJobEnvelope` — which has no tenant check of its own.
 * A forged or mis-routed envelope could read another tenant's blob that way.
 * Validate the ref; use the lease only for renewal (ADR-029).
 */
export function readEnvelopeTieredRefFromHeader(
  header: EnvelopeHeader,
): BlobRef | null {
  if ((header.e === "redis" || header.e === "s3") && header.ref) {
    return header.ref;
  }
  return null;
}

/**
 * Returns the ref together with its per-stage lease holder identity, or null
 * for inline bodies and unreadable values.
 */
export function readEnvelopeLease(
  value: string,
): { ref: BlobRef; holderId: string } | null {
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
  const headerJson = buf
    .subarray(lenEnd + 1, lenEnd + 1 + headerLen)
    .toString("utf8");
  // Guarded for the same reason the body parses are: a corrupt header segment
  // makes V8 echo it back ("Unexpected token 's', \"serId\":\"us\"..."), and the
  // header carries `m.__context` (traceId / userId / projectId). That message
  // would otherwise reach the drop log via the raw-Error path, which only strips
  // storage URIs. Naming it also makes a corrupt header a `malformed_envelope`
  // rather than an `unknown` (#5538).
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

import { randomUUID } from "node:crypto";

import type { Logger } from "@langwatch/observability";

import type { TenantId } from "~/server/event-sourcing/domain/tenantId";

import { MAX_BLOB_BYTES } from "./blobConstants";
import {
  compress,
  compressionMediaType,
  type CompressionCodec,
  contentHashSource,
  decodePayload,
  decompress,
  encodePayload,
} from "./bodyCodec";
import { gqEnvelopeGQ2DowngradeTotal, gqPayloadTooLargeTotal } from "./metrics";
import type { BlobRef, TieredBlobStore } from "./tieredBlobStore";

/**
 * Compression and payload codec are chosen at WRITE time behind flags, but READ
 * always sniffs the bytes and accepts every format we have ever written. That
 * asymmetry is the whole rollout story: ship readers that understand zstd and
 * msgpack with writes still off, let the fleet cycle, then flip the flags.
 *
 * Writing first is NOT safe here. `decodeJobEnvelope` throwing a plain Error
 * (unknown codec, failed parse) does not retry — `GroupQueue` only re-stages on
 * `TransientBlobStoreError`, so everything else terminates at the non-retryable
 * fail-safe, which completes the slot and drops the job to replay. An old worker
 * meeting a new body during a rolling deploy would silently discard it.
 */
function zstdWritesEnabled(): boolean {
  return process.env.GROUP_QUEUE_ZSTD_WRITES_ENABLED === "true";
}

function msgpackWritesEnabled(): boolean {
  return process.env.GROUP_QUEUE_MSGPACK_WRITES_ENABLED === "true";
}

function writeCompression(): CompressionCodec {
  return zstdWritesEnabled() ? "zstd" : "gzip";
}

/**
 * Decompression with the over-limit error converted to a park signal. bodyCodec
 * already caps both codecs' output at the encode ceiling (ADR-030 §1) so a
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

const errText = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

/**
 * A parse failure's message, with any echoed source text removed.
 *
 * **This is a PII guard, not tidiness.** V8 quotes the offending input back at
 * you: `JSON.parse("patient@hospital.example …")` throws
 * `Unexpected token 'p', "patient@ho"... is not valid JSON` — ten characters of
 * raw body. That message reaches the drop log (`GroupQueue.recordDrop` →
 * `err:`), and `redactStorageUrisInText` only strips storage URIs, so the
 * fragment would land in prod logs verbatim. The body is exactly the thing we
 * promised never to log (a staged payload can carry tenant PII), and it is the
 * thing we could not read anyway.
 *
 * Pre-dates this fix: the bare-JSON path already threw a raw `SyntaxError` that
 * #5736 then started logging. Fixed here rather than inherited (#5538).
 *
 * Keeps the diagnosis (`Unexpected token 'p'`, `Unterminated string`, position)
 * and drops only the quoted echo. zlib messages ("incorrect header check")
 * never echo input, so they pass through untouched.
 */
const safeParseErrText = (err: unknown): string => {
  const raw = errText(err);
  // ALLOWLIST, not blocklist: keep the leading diagnosis and drop everything from
  // the first delimiter a parser uses to hand input back — `"` (V8's echo, quoted
  // or truncated) or `[`/`{` (msgpackr's `{"type":"Buffer","data":[83,69]}`, whose
  // byte array decodes straight back to the plaintext).
  //
  // Matching V8's exact wording instead was the first attempt and it leaked: V8
  // only appends `"..."` at ~21+ chars and echoes the WHOLE string below that, so
  // a 9-digit SSN or a 6-digit OTP sailed through untouched. A blocklist over one
  // library's message shapes re-opens on every runtime upgrade — the same
  // fragility `DecodeFailureReason` exists to avoid for classification.
  //
  // What survives the cut is vocabulary, not payload: "Unexpected token 'x'",
  // "Unterminated string in JSON at position 30", "incorrect header check". The
  // single-quoted token is one character — kept because it is the most useful
  // byte in the message and one character is not a secret.
  const cut = raw.search(/["[{]/);
  const head = (cut === -1 ? raw : raw.slice(0, cut)).trim().replace(/[,\s]+$/, "");
  const name = err instanceof Error ? err.name : "Error";
  return head ? `${name}: ${head}` : name;
};

/**
 * Decode-side twin of {@link assertPayloadWithinCap}: values staged before the
 * encode cap existed (or via the bare-JSON path when envelope writes are off)
 * must not reach JSON.parse unbounded - a synchronous parse of a runaway value
 * seizes the worker event loop, which the liveness probe converts into a
 * process-wide crash loop.
 */
function assertDecodeWithinCap(byteLength: number): void {
  if (byteLength > MAX_BLOB_BYTES) {
    throw new PayloadTooLargeError(byteLength);
  }
}

/**
 * Versioned envelope for staged job values: `GQ<v>|<headerLen>|<headerJson><body>`.
 *
 * The header carries only what dispatch-time Lua and the ops dashboard need
 * without touching the body (routing fields + body encoding). The body is the
 * full payload JSON: raw or gzip+base64 inline when it stays in the envelope,
 * or empty when offloaded to a standalone blob whose reference the header
 * carries.
 *
 * - **GQ1** (ADR-026): offloads bodies > 32 KiB to a `randomUUID()` Redis key
 *   via {@link JobBlobStore} (`e:"ref"`, header `r`). No content identity.
 * - **GQ2** (ADR-029): offloads bodies > 4 KiB to a **content-addressed,
 *   tenant-namespaced** blob via {@link TieredBlobStore}, tiered Redis→object
 *   store (`e:"redis"|"s3"`, header `ref`). Identical bytes collapse to one
 *   stored copy. Active only when a tiered store + projectId are supplied.
 *
 * Values without a `GQ1|`/`GQ2|` prefix are legacy bare JSON and decode as-is.
 */
const ENVELOPE_PREFIX_V1 = "GQ1|";
const ENVELOPE_PREFIX_V2 = "GQ2|";
/** Both prefixes are 4 ASCII bytes; the length/header parse is identical after them. */
const ENVELOPE_PREFIX_LEN = 4;

/** gzip+base64 of sub-kilobyte JSON is frequently larger than the input. */
const COMPRESSION_THRESHOLD_BYTES = 1024;

/**
 * GQ1: above this, the body moves to a standalone `randomUUID()` blob key.
 */
const BLOB_OFFLOAD_THRESHOLD_BYTES = 32 * 1024;

/**
 * GQ2: above this, the body moves to the content-addressed tiered store. Lower
 * than GQ1's threshold so ordinary fan-out events cross into the dedup tier
 * rather than inlining N× (ADR-029).
 */
const INLINE_CEILING_BYTES = 4 * 1024;

/**
 * Phase gate for the format rollout (ADR-026). Readers are always
 * envelope-aware, but writes stay legacy bare JSON until every consumer in the
 * fleet is known to read envelopes. Read at call time so tests can toggle it
 * without module reloads.
 */
function envelopeWritesEnabled(): boolean {
  return process.env.GROUP_QUEUE_ENVELOPE_WRITES_ENABLED === "true";
}

/**
 * Storage for GQ1 offloaded envelope bodies. Implementations must persist with
 * a TTL safety net: deletion is best-effort at job completion, and a blob whose
 * job was squashed by dedup or lost in a crash must eventually expire.
 */
export interface JobBlobStore {
  /** `ttlSeconds` overrides the GQ1 default backstop (see {@link RedisJobBlobStore}). */
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

type BodyEncoding = "j" | "gz" | "ref" | "redis" | "s3";

export interface EnvelopeHeader {
  v: number;
  e: BodyEncoding;
  /** GQ1 offloaded blob id. */
  r?: string;
  /** GQ2 content-addressed tiered blob reference. */
  ref?: BlobRef;
  /** GQ2 per-stage lease holder identity for this staged occupancy. */
  h?: string;
  /** Routing fields read by the Lua dispatcher and ops dashboard WITHOUT parsing the body. */
  p?: string;
  t?: string;
  n?: string;
  /**
   * GQ2: queue-machinery fields (every `__*` key in jobData) lifted out of the
   * body so they don't perturb the content hash. Restored onto the parsed body
   * on decode. The user payload is everything else; the body is hashed over
   * the payload alone, so the same event fanned out to N reactors collapses to
   * one stored blob (ADR-029). Allowlist-free: any future `__*` field is
   * automatically treated as machinery.
   */
  m?: Record<string, unknown>;
}

/**
 * GQ2: split jobData into (machinery, payload). Every `__*` key is queue
 * machinery — the queue assigns these fields per-stage (`__stagedJobId`,
 * `__attempt`, `__context`) or per-reactor (`__jobName`, `__jobType`,
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
): Promise<string> {
  if (jsonBytes > COMPRESSION_THRESHOLD_BYTES) {
    const compressed = (await compress(json, writeCompression())).toString(
      "base64",
    );
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
  /** Body encoding — "redis" | "s3" | "ref" | "gz" | "j" (wire: `header.e`). */
  format: string | null;
  /** Envelope version (wire: `header.v`). */
  version: number | null;
  /** GQ1 blob id or GQ2 tiered blob hash, whichever the envelope carries. */
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
 * and storage machinery, and blob ids are content hashes / UUIDs.
 */
/**
 * A blob id only if it LOOKS like one. This reader runs on envelopes we already
 * know are malformed, so `header.r` / `header.ref.hash` are attacker-shaped
 * strings by that point and the value goes straight to a log. Anything off-shape
 * becomes null rather than a free-text field in the drop record (#5538, review).
 *
 * One alphabet covers both id shapes, because GQ1's is a subset of GQ2's:
 * - **GQ1** — `randomUUID()`: 36 chars of `[0-9a-f-]`.
 * - **GQ2** — `sha256(bytes).subarray(0,16).toString("base64url")`
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
      blobId: safeBlobId(
        readEnvelopeBlobIdFromHeader(header) ?? header.ref?.hash ?? null,
      ),
    };
  } catch {
    return { format: null, version: null, blobId: null };
  }
}

/** Guards the payload-size ceiling (ADR-030 §1). Emits a tenant-attributed warn before rejecting. */
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
  blobs,
  tieredBlobs,
  projectId,
  writesEnabled,
  queueName,
  logger,
}: {
  jobData: Record<string, unknown>;
  blobs?: JobBlobStore;
  tieredBlobs?: TieredBlobStore;
  projectId?: TenantId;
  /**
   * Explicit override of the format-rollout gate. When omitted, the encoder
   * falls back to the `GROUP_QUEUE_ENVELOPE_WRITES_ENABLED` env var (call-time
   * read, so tests can toggle without module reload). Composition roots should
   * thread this through explicitly so a partial fleet rollout doesn't put
   * mixed GQ1/GQ2 values in the same group's hash space until every pod cycles.
   */
  writesEnabled?: boolean;
  /** Optional queue name for observability labels. */
  queueName?: string;
  /** Optional logger for tenant-attributed warn on cap / downgrade. */
  logger?: Logger;
}): Promise<string> {
  const enabled = writesEnabled ?? envelopeWritesEnabled();

  // GQ2: content-addressed, tenant-namespaced, tiered offload. Active only once
  // the composition root supplies a tiered store and the job's tenant. If
  // either is missing we fall back to GQ1 — noisy so a regression in the
  // composition root can't ship a silently-downgraded pipeline.
  if (enabled && tieredBlobs && projectId) {
    const header = routingHeader(jobData, 2);
    // Lift queue machinery into the header so it doesn't perturb the content
    // hash. Without this, N reactors fanning out the same event produce N
    // different hashes because each carries its own __jobName / __attempt
    // (ADR-029). The body now contains only the user payload.
    const { machinery, payload } = splitMachineryFromBody(jobData);
    // The routing trio is already in header.p/t/n via routingHeader(); drop
    // the duplicate copy from m so the wire format isn't ~50 bytes heavier
    // per envelope and the two can't drift.
    delete machinery.__pipelineName;
    delete machinery.__jobType;
    delete machinery.__jobName;
    if (Object.keys(machinery).length > 0) {
      header.m = machinery;
    }

    // GQ2 never serializes `jobData` as a whole — only the payload. The old
    // `JSON.stringify(jobData)` above this branch was a second full pass whose
    // result this path then threw away.
    const { bytes, codec, json: payloadJson } = encodePayload(payload, {
      msgpackEnabled: msgpackWritesEnabled(),
    });
    const payloadBytes = bytes.length;
    assertPayloadWithinCap(payloadBytes, { projectId, queueName, logger });

    if (payloadBytes > INLINE_CEILING_BYTES) {
      const compression = writeCompression();
      const ref = await tieredBlobs.put({
        projectId,
        data: await compress(bytes, compression),
        // Hash the RAW payload, never the compressed output — the dedup key must
        // not depend on gzip/zstd determinism (library version/level; ADR-030
        // §1). The codec is folded in so a JSON-encoded and a msgpack-encoded
        // copy of the same payload can't collide on one key with different bytes
        // mid-rollout.
        hashSource: contentHashSource({ codec, json: payloadJson, bytes }),
        mediaType: compressionMediaType(compression),
      });
      header.e = ref.tier;
      header.ref = ref;
      // Per-stage lease holder identity for this staged
      // occupancy. Lives in the (inline) header, never in the content-addressed
      // body, so it doesn't perturb the blob hash that collapses the fan-out.
      header.h = randomUUID();
      return finalize(ENVELOPE_PREFIX_V2, header, "");
    }

    // Inline bodies are under INLINE_CEILING_BYTES (4KB) and msgpack only
    // engages above MSGPACK_MIN_BYTES (100KB), so an inline body is always JSON.
    return finalize(
      ENVELOPE_PREFIX_V2,
      header,
      await inlineBody(payloadJson ?? bytes.toString("utf-8"), payloadBytes, header),
    );
  }

  const json = JSON.stringify(jobData);
  if (!enabled) {
    return json;
  }
  const jsonBytes = Buffer.byteLength(json);
  assertPayloadWithinCap(jsonBytes, { projectId, queueName, logger });

  // GQ1 fallback path: reached when the caller opted into writes but didn't
  // supply BOTH a tiered store and a projectId. Loud so a composition-root
  // regression can't silently ship a pipeline without dedup / blob leasing /
  // tenant namespacing (2026-06-24 review).
  if (queueName) gqEnvelopeGQ2DowngradeTotal.inc({ queue_name: queueName });
  if (logger) {
    logger.warn(
      {
        projectId,
        hasTieredBlobs: Boolean(tieredBlobs),
        hasProjectId: Boolean(projectId),
        queueName,
      },
      "GQ2 encode downgraded to GQ1 (tenant or tiered store missing at composition root)",
    );
  }
  const header = routingHeader(jobData, 1);
  if (blobs && jsonBytes > BLOB_OFFLOAD_THRESHOLD_BYTES) {
    const id = randomUUID();
    await blobs.put({ id, data: await compress(json, writeCompression()) });
    header.e = "ref";
    header.r = id;
    return finalize(ENVELOPE_PREFIX_V1, header, "");
  }
  return finalize(
    ENVELOPE_PREFIX_V1,
    header,
    await inlineBody(json, jsonBytes, header),
  );
}

export async function decodeJobEnvelope({
  value,
  blobs,
  tieredBlobs,
  readMode = "get",
  parsed,
}: {
  value: string;
  blobs?: JobBlobStore;
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
    assertDecodeWithinCap(Buffer.byteLength(value, "utf8"));
    // Legacy bare JSON. An unparseable one is still a body we HAVE and cannot
    // read, so it earns a name like any other — otherwise it lands in `unknown`
    // and looks like a gap in the enum rather than the thing it is.
    return parseInlineBody(value);
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

  // GQ1: randomUUID offloaded blob.
  if (header.e === "ref") {
    if (typeof header.r !== "string" || header.r.length === 0) {
      throw new DecodeFailureError({
      message: "Malformed job envelope: ref body without a blob id",
      reason: "malformed_envelope",
    });
    }
    if (!blobs) {
      throw new Error(
        "Job envelope references an offloaded blob but no blob store was provided",
      );
    }
    const data =
      readMode === "peek"
        ? await blobs.peek({ id: header.r })
        : await blobs.get({ id: header.r });
    if (!data) {
      throw new DecodeFailureError({
      message: `Job envelope blob ${header.r} is missing (deleted or expired)`,
      reason: "missing_blob",
    });
    }
    return await decodeBody(data);
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
  // GQ2 inline lifted machinery into header.m too; GQ1 (v=1) never did.
  return header.v === 2 ? mergeMachinery(parsedBody, header) : parsedBody;
}

/**
 * Reads routing fields from the header alone (envelope values) or via a full
 * parse (legacy bare JSON). Never throws; unreadable values yield nulls.
 */
export function readJobRoutingMeta(value: string): JobRoutingMeta {
  try {
    if (isEnvelope(value)) {
      const { header } = splitEnvelope(value);
      return {
        pipelineName: typeof header.p === "string" ? header.p : null,
        jobType: typeof header.t === "string" ? header.t : null,
        jobName: typeof header.n === "string" ? header.n : null,
      };
    }
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return {
      pipelineName:
        typeof parsed.__pipelineName === "string"
          ? parsed.__pipelineName
          : null,
      jobType: typeof parsed.__jobType === "string" ? parsed.__jobType : null,
      jobName: typeof parsed.__jobName === "string" ? parsed.__jobName : null,
    };
  } catch {
    return { pipelineName: null, jobType: null, jobName: null };
  }
}

/**
 * The GQ1 offloaded-blob id from a parsed envelope header, or null for inline
 * bodies, GQ2 tiered refs, and legacy JSON. The retirement paths read it via
 * {@link readEnvelopeRetirement} so completion/restage pay a single parse.
 */
export function readEnvelopeBlobIdFromHeader(
  header: EnvelopeHeader,
): string | null {
  return header.e === "ref" && typeof header.r === "string" ? header.r : null;
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
 * Validate the ref; use the lease only for renewal (ADR-030 §5).
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
 * Returns the GQ2 ref together with its per-stage lease holder identity, or
 * null for inline bodies, GQ1 refs, legacy JSON, and unreadable values.
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
 * Single parse for retirement: given a staged value, return the GQ2 lease and/or
 * GQ1 blob id from ONE `splitEnvelope`. Prefer over calling `readEnvelopeLease`
 * + the blob-id read in sequence on the completion / restage hot path
 * (2026-06-24 review).
 */
export function readEnvelopeRetirement(value: string): {
  lease: { ref: BlobRef; holderId: string } | null;
  blobId: string | null;
} {
  try {
    if (!isEnvelope(value)) return { lease: null, blobId: null };
    const { header } = splitEnvelope(value);
    return {
      lease: readEnvelopeLeaseFromHeader(header),
      blobId: readEnvelopeBlobIdFromHeader(header),
    };
  } catch {
    return { lease: null, blobId: null };
  }
}

export function isEnvelope(value: string): boolean {
  return (
    value.startsWith(ENVELOPE_PREFIX_V1) || value.startsWith(ENVELOPE_PREFIX_V2)
  );
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
  return {
    header,
    body: buf.subarray(lenEnd + 1 + headerLen).toString("utf8"),
  };
}

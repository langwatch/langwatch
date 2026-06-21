import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";

import type { TenantId } from "~/server/event-sourcing/domain/tenantId";

import { MAX_BLOB_BYTES } from "./blobConstants";
import type { BlobRef, TieredBlobStore } from "./tieredBlobStore";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

/**
 * Cap decompression output at the same ceiling encode enforces (ADR-030 §1), so
 * a tampered or corrupt blob (e.g. a tenant zip-bombing their own BYOC object)
 * can't OOM the worker. zlib throws past the limit; decode lets that propagate to
 * the missing-blob fail-safe (complete the slot, recover via replay).
 */
const DECODE_GUNZIP_OPTS = { maxOutputLength: MAX_BLOB_BYTES };

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
  put(params: { id: string; data: Buffer }): Promise<void>;
  get(params: { id: string }): Promise<Buffer | null>;
  delete(params: { id: string }): Promise<void>;
}

export interface JobRoutingMeta {
  pipelineName: string | null;
  jobType: string | null;
  jobName: string | null;
}

type BodyEncoding = "j" | "gz" | "ref" | "redis" | "s3";

interface EnvelopeHeader {
  v: number;
  e: BodyEncoding;
  /** GQ1 offloaded blob id. */
  r?: string;
  /** GQ2 content-addressed tiered blob reference. */
  ref?: BlobRef;
  /** GQ2 per-stage hold token — the holder-set member for this staged occupancy. */
  h?: string;
  p?: string;
  t?: string;
  n?: string;
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
 * gzip+base64 when compression actually wins (mutates `header.e` to `"gz"`).
 */
async function inlineBody(
  json: string,
  jsonBytes: number,
  header: EnvelopeHeader,
): Promise<string> {
  if (jsonBytes > COMPRESSION_THRESHOLD_BYTES) {
    const compressed = (await gzipAsync(json)).toString("base64");
    // High-entropy payloads (inline base64-ish data) can come out LARGER after
    // gzip+base64; keep raw JSON unless compression actually wins. `"gz"` costs
    // one more header byte than `"j"`.
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

/** Guards the payload-size ceiling (ADR-030 §1). */
export function assertPayloadWithinCap(jsonBytes: number): void {
  if (jsonBytes > MAX_BLOB_BYTES) {
    throw new PayloadTooLargeError(jsonBytes);
  }
}

export async function encodeJobEnvelope({
  jobData,
  blobs,
  tieredBlobs,
  projectId,
}: {
  jobData: Record<string, unknown>;
  blobs?: JobBlobStore;
  tieredBlobs?: TieredBlobStore;
  projectId?: TenantId;
}): Promise<string> {
  const json = JSON.stringify(jobData);
  if (!envelopeWritesEnabled()) {
    return json;
  }
  const jsonBytes = Buffer.byteLength(json);
  assertPayloadWithinCap(jsonBytes);

  // GQ2: content-addressed, tenant-namespaced, tiered offload. Active only once
  // the composition root supplies a tiered store and the job's tenant.
  if (tieredBlobs && projectId) {
    const header = routingHeader(jobData, 2);
    if (jsonBytes > INLINE_CEILING_BYTES) {
      const ref = await tieredBlobs.put({
        projectId,
        data: await gzipAsync(json),
        // Hash the RAW json, not the gzip output, so the dedup key is independent
        // of gzip determinism (zlib version/level) — ADR-030 §1.
        hashSource: Buffer.from(json, "utf8"),
      });
      header.e = ref.tier;
      header.ref = ref;
      // Per-stage hold token: the holder-set member identifying this staged
      // occupancy. Lives in the (inline) header, never in the content-addressed
      // body, so it doesn't perturb the blob hash that collapses the fan-out.
      header.h = randomUUID();
      return finalize(ENVELOPE_PREFIX_V2, header, "");
    }
    return finalize(
      ENVELOPE_PREFIX_V2,
      header,
      await inlineBody(json, jsonBytes, header),
    );
  }

  // GQ1: legacy randomUUID offload (unchanged).
  const header = routingHeader(jobData, 1);
  if (blobs && jsonBytes > BLOB_OFFLOAD_THRESHOLD_BYTES) {
    const id = randomUUID();
    await blobs.put({ id, data: await gzipAsync(json) });
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
}: {
  value: string;
  blobs?: JobBlobStore;
  tieredBlobs?: TieredBlobStore;
}): Promise<Record<string, unknown>> {
  if (!isEnvelope(value)) {
    return JSON.parse(value) as Record<string, unknown>;
  }

  const { header, body } = splitEnvelope(value);

  // GQ2: content-addressed tiered blob.
  if (header.e === "redis" || header.e === "s3") {
    if (!header.ref) {
      throw new Error("Malformed job envelope: tiered body without a blob ref");
    }
    if (!tieredBlobs) {
      throw new Error(
        "Job envelope references a tiered blob but no tiered store was provided",
      );
    }
    const data = await tieredBlobs.get(header.ref);
    if (!data) {
      throw new Error(
        "Job envelope tiered blob is missing (deleted or expired)",
      );
    }
    return JSON.parse(
      (await gunzipAsync(data, DECODE_GUNZIP_OPTS)).toString("utf8"),
    ) as Record<string, unknown>;
  }

  // GQ1: randomUUID offloaded blob.
  if (header.e === "ref") {
    if (typeof header.r !== "string" || header.r.length === 0) {
      throw new Error("Malformed job envelope: ref body without a blob id");
    }
    if (!blobs) {
      throw new Error(
        "Job envelope references an offloaded blob but no blob store was provided",
      );
    }
    const data = await blobs.get({ id: header.r });
    if (!data) {
      throw new Error(
        `Job envelope blob ${header.r} is missing (deleted or expired)`,
      );
    }
    return JSON.parse(
      (await gunzipAsync(data, DECODE_GUNZIP_OPTS)).toString("utf8"),
    ) as Record<string, unknown>;
  }

  const json =
    header.e === "gz"
      ? (
          await gunzipAsync(Buffer.from(body, "base64"), DECODE_GUNZIP_OPTS)
        ).toString("utf8")
      : body;
  return JSON.parse(json) as Record<string, unknown>;
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
 * Returns the GQ1 offloaded-blob id of an envelope value, or null for inline
 * bodies, GQ2 tiered refs, legacy JSON, and unreadable values. Used by the
 * completion and restage paths to delete blobs whose staged value is retired.
 */
export function readEnvelopeBlobId(value: string): string | null {
  try {
    if (!isEnvelope(value)) return null;
    const { header } = splitEnvelope(value);
    return header.e === "ref" && typeof header.r === "string" ? header.r : null;
  } catch {
    return null;
  }
}

/**
 * Returns the GQ2 ref together with its per-stage hold token (the holder-set
 * member), or null for inline bodies, GQ1 refs, legacy JSON, and unreadable
 * values. The acquire/release seams use this to reference-count the blob
 * without depending on the Lua-internal slot id.
 */
export function readEnvelopeHold(
  value: string,
): { ref: BlobRef; token: string } | null {
  try {
    if (!isEnvelope(value)) return null;
    const { header } = splitEnvelope(value);
    if (
      (header.e === "redis" || header.e === "s3") &&
      header.ref &&
      typeof header.h === "string"
    ) {
      return { ref: header.ref, token: header.h };
    }
    return null;
  } catch {
    return null;
  }
}

function isEnvelope(value: string): boolean {
  return (
    value.startsWith(ENVELOPE_PREFIX_V1) || value.startsWith(ENVELOPE_PREFIX_V2)
  );
}

function splitEnvelope(value: string): {
  header: EnvelopeHeader;
  body: string;
} {
  const lenEnd = value.indexOf("|", ENVELOPE_PREFIX_LEN);
  if (lenEnd === -1) {
    throw new Error("Malformed job envelope: missing header length delimiter");
  }
  const lenDigits = value.slice(ENVELOPE_PREFIX_LEN, lenEnd);
  if (!/^\d+$/.test(lenDigits)) {
    throw new Error("Malformed job envelope: invalid header length");
  }
  const headerLen = Number(lenDigits);
  if (headerLen <= 0) {
    throw new Error("Malformed job envelope: invalid header length");
  }
  // Prefix and length digits are ASCII, so lenEnd is the same offset in bytes
  // and code units; the header itself must be sliced as bytes to match Lua.
  const buf = Buffer.from(value, "utf8");
  const headerJson = buf
    .subarray(lenEnd + 1, lenEnd + 1 + headerLen)
    .toString("utf8");
  const header = JSON.parse(headerJson) as EnvelopeHeader;
  return {
    header,
    body: buf.subarray(lenEnd + 1 + headerLen).toString("utf8"),
  };
}

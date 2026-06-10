import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

/**
 * Versioned envelope for staged job values: `GQ1|<headerLen>|<headerJson><body>`.
 *
 * The header carries only what dispatch-time Lua and the ops dashboard need
 * without touching the body (routing fields + body encoding); the body is the
 * full payload JSON, gzip+base64 when it exceeds the threshold. Values without
 * the prefix are legacy bare JSON and decode as-is. See ADR-026.
 */
const ENVELOPE_PREFIX = "GQ1|";

/** gzip+base64 of sub-kilobyte JSON is frequently larger than the input. */
const COMPRESSION_THRESHOLD_BYTES = 1024;

export interface JobRoutingMeta {
  pipelineName: string | null;
  jobType: string | null;
  jobName: string | null;
}

interface EnvelopeHeader {
  v: number;
  e: "j" | "gz";
  p?: string;
  t?: string;
  n?: string;
}

export async function encodeJobEnvelope(
  jobData: Record<string, unknown>,
): Promise<string> {
  const json = JSON.stringify(jobData);

  const header: EnvelopeHeader = { v: 1, e: "j" };
  if (typeof jobData.__pipelineName === "string")
    header.p = jobData.__pipelineName;
  if (typeof jobData.__jobType === "string") header.t = jobData.__jobType;
  if (typeof jobData.__jobName === "string") header.n = jobData.__jobName;

  let body = json;
  if (Buffer.byteLength(json) > COMPRESSION_THRESHOLD_BYTES) {
    header.e = "gz";
    body = (await gzipAsync(json)).toString("base64");
  }

  const headerJson = JSON.stringify(header);
  // Header length is in BYTES: the Lua reader slices bytes, and UTF-16 code
  // units diverge from bytes if a routing field ever carries non-ASCII.
  return `${ENVELOPE_PREFIX}${Buffer.byteLength(headerJson)}|${headerJson}${body}`;
}

export async function decodeJobEnvelope(
  value: string,
): Promise<Record<string, unknown>> {
  if (!value.startsWith(ENVELOPE_PREFIX)) {
    return JSON.parse(value) as Record<string, unknown>;
  }

  const { header, body } = splitEnvelope(value);
  const json =
    header.e === "gz"
      ? (await gunzipAsync(Buffer.from(body, "base64"))).toString("utf8")
      : body;
  return JSON.parse(json) as Record<string, unknown>;
}

/**
 * Reads routing fields from the header alone (envelope values) or via a full
 * parse (legacy bare JSON). Never throws; unreadable values yield nulls.
 */
export function readJobRoutingMeta(value: string): JobRoutingMeta {
  try {
    if (value.startsWith(ENVELOPE_PREFIX)) {
      const { header } = splitEnvelope(value);
      return {
        pipelineName: header.p ?? null,
        jobType: header.t ?? null,
        jobName: header.n ?? null,
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

function splitEnvelope(value: string): {
  header: EnvelopeHeader;
  body: string;
} {
  const lenEnd = value.indexOf("|", ENVELOPE_PREFIX.length);
  if (lenEnd === -1) {
    throw new Error("Malformed job envelope: missing header length delimiter");
  }
  const lenDigits = value.slice(ENVELOPE_PREFIX.length, lenEnd);
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

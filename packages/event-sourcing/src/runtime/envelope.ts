import { EventSourcingError } from "../errors";
import type { Job, JobHeader } from "./contracts";

/** A malformed envelope: the header segment cannot be sliced out or parsed.
 * The plane writes every envelope itself, so this is an invariant violation,
 * never a user-facing condition. */
export class MalformedEnvelopeError extends EventSourcingError {
  constructor(reason: string, cause?: unknown) {
    super(`malformed job envelope (${reason})`, { reason });
    if (cause !== undefined) this.cause = cause;
  }
}

const HEADER_SEPARATOR = "|";

function splitEnvelope(encoded: string): {
  header: JobHeader;
  bodyStart: number;
} {
  const separatorAt = encoded.indexOf(HEADER_SEPARATOR);
  if (separatorAt === -1)
    throw new MalformedEnvelopeError("no header separator");

  const length = Number(encoded.slice(0, separatorAt));
  if (!Number.isInteger(length) || length < 0) {
    throw new MalformedEnvelopeError(
      "header length is not a non-negative integer",
    );
  }

  const headerStart = separatorAt + 1;
  const headerJson = encoded.slice(headerStart, headerStart + length);
  let header: JobHeader;
  try {
    header = JSON.parse(headerJson) as JobHeader;
  } catch (cause) {
    throw new MalformedEnvelopeError("header is not valid JSON", cause);
  }
  return { header, bodyStart: headerStart + length };
}

/**
 * Encodes a job as `<headerLength>|<headerJSON><body>`. The header is a fixed
 * segment in front of the body, so reading it never touches the body — a 4
 * MiB body costs nothing to read a sequence off (ADR-108 decision 6).
 */
export function encodeJob(job: Job): string {
  const header = JSON.stringify(job.header);
  return `${header.length}${HEADER_SEPARATOR}${header}${job.body}`;
}

export function decodeJob(encoded: string): Job {
  const { header, bodyStart } = splitEnvelope(encoded);
  return { header, body: encoded.slice(bodyStart) };
}

/** Reads the header alone. Used by the scheduler, metrics and the parked-lane
 * report, none of which may pay for the body. */
export function readHeader(encoded: string): JobHeader {
  return splitEnvelope(encoded).header;
}

export function readSequence(encoded: string): number {
  return readHeader(encoded).sequence;
}

/** A retry only ever advances `attempt` — every other header field and the
 * body are the ones the job was first staged with (ADR-108 decision 6). */
export function withAttempt(job: Job, attempt: number): Job {
  return { header: { ...job.header, attempt }, body: job.body };
}

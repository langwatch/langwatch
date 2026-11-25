/**
 * Restores `LogRecord.event_name` (OTLP field 12), which the pinned
 * otlp-transformer decoder predates and silently skips. Grok CLI names its
 * events only there: no body, no `event.name` attribute.
 * @see specs/ai-governance/ingestion-sources/grok-cli-otlp.feature
 */

import type { IExportLogsServiceRequest } from "@opentelemetry/otlp-transformer";

const WIRE_VARINT = 0;
const WIRE_FIXED64 = 1;
const WIRE_LENGTH_DELIMITED = 2;
const WIRE_FIXED32 = 5;

const REQUEST_RESOURCE_LOGS = 1;
const RESOURCE_LOGS_SCOPE_LOGS = 2;
const SCOPE_LOGS_LOG_RECORDS = 2;
const LOG_RECORD_EVENT_NAME = 12;

type Field = { field: number; wireType: number; start: number; end: number };

/** A cursor over one message's bytes; throws on anything malformed. */
class WireCursor {
  private pos: number;

  constructor(
    private readonly bytes: Uint8Array,
    start: number,
    private readonly end: number,
  ) {
    this.pos = start;
  }

  private varint(): number {
    let result = 0;
    let shift = 0;
    for (;;) {
      if (this.pos >= this.end || shift > 63) throw new Error("malformed varint");
      const byte = this.bytes[this.pos++]!;
      if (shift < 32) result += (byte & 0x7f) * 2 ** shift;
      if ((byte & 0x80) === 0) return result;
      shift += 7;
    }
  }

  private skip(count: number): number {
    const start = this.pos;
    this.pos += count;
    if (this.pos > this.end) throw new Error("field runs past its message");
    return start;
  }

  private sizeOf(wireType: number): number {
    if (wireType === WIRE_FIXED64) return 8;
    if (wireType === WIRE_FIXED32) return 4;
    if (wireType === WIRE_LENGTH_DELIMITED) return this.varint();
    return -1;
  }

  /** The next field's location, or null at the end of the message. */
  next(): Field | null {
    if (this.pos >= this.end) return null;
    const tag = this.varint();
    const field = Math.floor(tag / 8);
    const wireType = tag & 7;
    if (wireType === WIRE_VARINT) {
      const start = this.pos;
      this.varint();
      return { field, wireType, start, end: this.pos };
    }
    const size = this.sizeOf(wireType);
    if (size < 0) throw new Error(`unsupported wire type ${wireType}`);
    const start = this.skip(size);
    return { field, wireType, start, end: this.pos };
  }
}

function* submessages(bytes: Uint8Array, outer: Field, wanted: number): Generator<Field> {
  const cursor = new WireCursor(bytes, outer.start, outer.end);
  for (let found = cursor.next(); found; found = cursor.next()) {
    if (found.field === wanted && found.wireType === WIRE_LENGTH_DELIMITED) yield found;
  }
}

function eventNameOf(bytes: Uint8Array, record: Field): string | undefined {
  let name: string | undefined;
  for (const field of submessages(bytes, record, LOG_RECORD_EVENT_NAME)) {
    name = new TextDecoder().decode(bytes.subarray(field.start, field.end));
  }
  return name;
}

/**
 * Sets `eventName` on each decoded log record that carries one on the wire.
 * Repeated fields decode in wire order, so the n-th record on the wire is the
 * n-th decoded record. A record that already has a name keeps it.
 */
export function attachLogEventNames({
  request,
  bytes,
}: {
  request: IExportLogsServiceRequest;
  bytes: Uint8Array;
}): void {
  const whole: Field = { field: 0, wireType: WIRE_LENGTH_DELIMITED, start: 0, end: bytes.length };
  let resourceIndex = 0;
  for (const resourceLogs of submessages(bytes, whole, REQUEST_RESOURCE_LOGS)) {
    const decodedResource = request.resourceLogs?.[resourceIndex++];
    let scopeIndex = 0;
    for (const scopeLogs of submessages(bytes, resourceLogs, RESOURCE_LOGS_SCOPE_LOGS)) {
      const decodedScope = decodedResource?.scopeLogs?.[scopeIndex++];
      let recordIndex = 0;
      for (const record of submessages(bytes, scopeLogs, SCOPE_LOGS_LOG_RECORDS)) {
        const decoded = decodedScope?.logRecords?.[recordIndex++] as
          | { eventName?: string }
          | undefined;
        const name = eventNameOf(bytes, record);
        if (decoded && name && !decoded.eventName) decoded.eventName = name;
      }
    }
  }
}

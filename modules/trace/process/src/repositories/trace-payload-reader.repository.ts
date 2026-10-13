/** The event was read, but it carries no such field: a corrupted event or a stale reference. */
export class TraceEventPayloadFieldNotFoundError extends Error {
  constructor(
    readonly eventId: string,
    readonly field: string,
  ) {
    super(`Field "${field}" not found in the payload of event ${eventId}`);
    this.name = "TraceEventPayloadFieldNotFoundError";
  }
}

/** External claim-check payload reads for internal Trace full-record reads. */
export abstract class TracePayloadReaderRepository {
  /** Raises when the offloaded field cannot be served; the caller falls back to the preview. */
  abstract read(input: {
    tenantId: string;
    traceId: string;
    eventId: string;
    field: string;
  }): Promise<string>;
}

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

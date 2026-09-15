/** External claim-check payload reads for internal Trace full-record reads. */
export abstract class TracePayloadReaderRepository {
  abstract tryRead(input: {
    tenantId: string;
    traceId: string;
    eventId: string;
    field: string;
  }): Promise<string | null>;
}

/**
 * The spool half of the blob store: where an oversized command's payload is
 * parked so the command itself stays small (ADR-022).
 *
 * `recordSpanCommand` reconstitutes from it and best-effort deletes afterwards;
 * those two methods are all event-sourcing needs, and both take a plain key.
 */
export interface BlobStorePort {
  getSpool(spoolRef: string): Promise<Buffer>;
  deleteSpool(spoolRef: string): Promise<void>;
}

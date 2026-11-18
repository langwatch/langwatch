/**
 * The event log's bytes for a tenant, read through eventing's retention surface: the framework
 * owns that table, so no module's `*Api` answers for it (ADR-202 Decided 22). A store that
 * cannot answer throws.
 */
export interface StorageMeterRepository {
  /** `beforeMs` keeps events that occurred earlier, for billing's storage past 90 days. */
  getEventLogBytes(input: { tenantId: string; beforeMs?: number | undefined }): Promise<number>;
}

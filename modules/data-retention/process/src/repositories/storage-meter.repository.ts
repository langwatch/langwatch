/**
 * The event log's bytes for a tenant, read through eventing's retention surface: the framework
 * owns that table, so no module's `*Api` answers for it (ADR-202 Decided 22). A store that
 * cannot answer throws.
 */
export interface StorageMeterRepository {
  getEventLogBytes(input: { tenantId: string }): Promise<number>;
}

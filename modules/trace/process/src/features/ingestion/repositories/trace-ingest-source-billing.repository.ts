/** Whether an organization's ingestion source is billed, as trace last folded governance's fact. */
export type IngestSourceBilling = Readonly<{ billed: boolean; recordedAtMs: number }>;

export type IngestSourceKey = Readonly<{ organizationId: string; sourceType: string }>;

/**
 * Trace's fold of governance's coding-assistant billing fact (Q82, Alex 2026-10-06), one row
 * per (organization, source). A write keeps whichever of the stored and given facts is newer.
 */
export abstract class TraceIngestSourceBillingRepository {
  abstract find(key: IngestSourceKey): Promise<IngestSourceBilling | null>;
  abstract recordIfNewer(input: IngestSourceKey & IngestSourceBilling): Promise<void>;
}

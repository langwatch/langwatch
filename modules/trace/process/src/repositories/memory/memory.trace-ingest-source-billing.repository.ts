import {
  type IngestSourceBilling,
  type IngestSourceKey,
  TraceIngestSourceBillingRepository,
} from "../../features/ingestion/repositories/trace-ingest-source-billing.repository.ts";

/** In-memory twin of trace's Postgres fold of the coding-assistant billing fact. */
export class MemoryTraceIngestSourceBillingRepository extends TraceIngestSourceBillingRepository {
  private readonly rows = new Map<string, IngestSourceBilling>();

  static create(): MemoryTraceIngestSourceBillingRepository {
    return new MemoryTraceIngestSourceBillingRepository();
  }

  async find({ organizationId, sourceType }: IngestSourceKey): Promise<IngestSourceBilling | null> {
    return this.rows.get(rowKey({ organizationId, sourceType })) ?? null;
  }

  async recordIfNewer({
    organizationId,
    sourceType,
    billed,
    recordedAtMs,
  }: IngestSourceKey & IngestSourceBilling): Promise<void> {
    const key = rowKey({ organizationId, sourceType });
    const stored = this.rows.get(key);
    if (stored && stored.recordedAtMs >= recordedAtMs) return;
    this.rows.set(key, { billed, recordedAtMs });
  }
}

function rowKey({ organizationId, sourceType }: IngestSourceKey): string {
  return `${organizationId}:${sourceType}`;
}

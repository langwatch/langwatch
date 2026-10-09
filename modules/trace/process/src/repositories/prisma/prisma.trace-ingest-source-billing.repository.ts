import { prismaTables, type PrismaModelClient } from "@langwatch/prisma-client";
import { Temporal, toDate, toEpochMs } from "@langwatch/time";

import {
  type IngestSourceBilling,
  type IngestSourceKey,
  TraceIngestSourceBillingRepository,
} from "../../features/ingestion/repositories/trace-ingest-source-billing.repository.ts";

type PrismaTraceIngestSourceBillingDatabase = PrismaModelClient<"TraceIngestSourceBilling">;

/** Prisma's unique-constraint failure, read off the code so it survives a client boundary. */
function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002"
  );
}

/** Trace's fold of governance's billing fact over Postgres; every query names its organization. */
export class PrismaTraceIngestSourceBillingRepository extends TraceIngestSourceBillingRepository {
  static readonly tables = prismaTables("TraceIngestSourceBilling");

  static create({
    prisma,
  }: {
    prisma: PrismaTraceIngestSourceBillingDatabase;
  }): PrismaTraceIngestSourceBillingRepository {
    return new PrismaTraceIngestSourceBillingRepository(prisma);
  }

  private constructor(private readonly database: PrismaTraceIngestSourceBillingDatabase) {
    super();
  }

  async find({ organizationId, sourceType }: IngestSourceKey): Promise<IngestSourceBilling | null> {
    const row = await this.database.traceIngestSourceBilling.findUnique({
      where: { organizationId_sourceType: { organizationId, sourceType } },
      select: { billed: true, recordedAt: true },
    });
    return row ? { billed: row.billed, recordedAtMs: toEpochMs(row.recordedAt) } : null;
  }

  async recordIfNewer({
    organizationId,
    sourceType,
    billed,
    recordedAtMs,
  }: IngestSourceKey & IngestSourceBilling): Promise<void> {
    const recordedAt = toDate(Temporal.Instant.fromEpochMilliseconds(recordedAtMs));
    if (await this.#updateIfOlder({ organizationId, sourceType, billed, recordedAt })) return;
    try {
      await this.database.traceIngestSourceBilling.create({
        data: { organizationId, sourceType, billed, recordedAt },
      });
    } catch (error) {
      if (!isUniqueConstraintViolation(error)) throw error;
      // A concurrent fold created the row first; keep ours only if it is newer.
      await this.#updateIfOlder({ organizationId, sourceType, billed, recordedAt });
    }
  }

  async #updateIfOlder({
    organizationId,
    sourceType,
    billed,
    recordedAt,
  }: IngestSourceKey & { billed: boolean; recordedAt: Date }): Promise<boolean> {
    const existing = await this.database.traceIngestSourceBilling.updateMany({
      where: { organizationId, sourceType, recordedAt: { lt: recordedAt } },
      data: { billed, recordedAt },
    });
    if (existing.count > 0) return true;
    const stored = await this.database.traceIngestSourceBilling.count({
      where: { organizationId, sourceType },
    });
    return stored > 0;
  }
}

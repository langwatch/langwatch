import { createLogger } from "@langwatch/observability";
import type { StoredObjectId, StoredObjectProjectId } from "@langwatch/stored-object-contract";

import type { StoredObjectBytesRepository } from "../repositories/stored-object-bytes.repository.ts";
import type {
  StoredObjectRecord,
  StoredObjectRecordRepository,
} from "../repositories/stored-object-record.repository.ts";
import { LEGACY_EVALUATION_INPUTS_PURPOSE } from "../rules/legacy-evaluation-inputs.rules.ts";

const logger = createLogger("langwatch:stored-object:legacy-evaluation-inputs-purge");

export type LegacyEvaluationInputsPurgeReport = Readonly<{
  scanned: number;
  bytesDeleted: number;
  rowsDeleted: number;
  failed: number;
}>;

/** ADR-172: removes main-era evaluation_inputs rows and bytes; must run after evaluation copies. */
export class LegacyEvaluationInputsPurgeService {
  private constructor(
    private readonly records: StoredObjectRecordRepository,
    private readonly bytes: StoredObjectBytesRepository,
    private readonly pageSize: number,
  ) {}

  static create({
    records,
    bytes,
    pageSize = 200,
  }: {
    records: StoredObjectRecordRepository;
    bytes: StoredObjectBytesRepository;
    pageSize?: number;
  }): LegacyEvaluationInputsPurgeService {
    return new LegacyEvaluationInputsPurgeService(records, bytes, pageSize);
  }

  /** Dry run counts what an apply would remove and deletes nothing. */
  async purge({
    apply,
    signal,
  }: {
    apply: boolean;
    signal: AbortSignal;
  }): Promise<LegacyEvaluationInputsPurgeReport> {
    const totals = { scanned: 0, bytesDeleted: 0, rowsDeleted: 0, failed: 0 };
    let after: { tenantId: StoredObjectProjectId; id: StoredObjectId } | undefined;
    let more = true;

    while (more) {
      signal.throwIfAborted();
      const page = await this.records.findPageByPurpose({
        purpose: LEGACY_EVALUATION_INPUTS_PURPOSE,
        ...(after ? { after } : {}),
        limit: this.pageSize,
      });
      more = page.length > 0;
      for (const row of page) {
        totals.scanned += 1;
        if (apply) await this.purgeRow({ row, totals });
      }
      const last = page.at(-1);
      if (last) after = { tenantId: last.tenantId, id: last.id };
    }

    return totals;
  }

  private async purgeRow({
    row,
    totals,
  }: {
    row: StoredObjectRecord;
    totals: { bytesDeleted: number; rowsDeleted: number; failed: number };
  }): Promise<void> {
    try {
      if (row.storage) {
        await this.bytes.delete({ projectId: row.tenantId, address: row.storage });
        totals.bytesDeleted += 1;
      }
      await this.records.delete({ tenantId: row.tenantId, id: row.id });
      totals.rowsDeleted += 1;
    } catch (error) {
      totals.failed += 1;
      logger.warn({ tenantId: row.tenantId, id: row.id, error }, "Purge left the row");
    }
  }
}

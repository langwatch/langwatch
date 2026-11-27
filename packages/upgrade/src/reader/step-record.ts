import type { UpgradePostgres } from "../ports.ts";
import { UpgradeReaderRepository } from "./reader.repository.ts";

/** What the ledger holds for one step: its status, its last report and when its attempt began. */
export interface LedgerStepRecord {
  status: string;
  report: Record<string, unknown> | null;
  startedAt: string | null;
}

/**
 * The ledger's record of one step, for a module that reads its own step's report while serving
 * (a replay's recorded since). Empty when the ledger has no row for it, or no ledger yet.
 */
export async function findLedgerStepRecords({
  postgres,
  id,
}: {
  postgres: UpgradePostgres;
  id: string;
}): Promise<LedgerStepRecord[]> {
  const repository = UpgradeReaderRepository.create({ postgres });
  const tables = await repository.findTables();
  const rows = await repository.findStepById({ tables, id });
  return rows.map((row) => ({
    status: row.status,
    report: row.report,
    startedAt: row.started_at,
  }));
}

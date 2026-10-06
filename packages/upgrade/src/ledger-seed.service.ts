import { UpgradeLedgerRepository } from "./ledger.repository.ts";
import type { UpgradeRun, UpgradeStepKind } from "./ledger.ts";
import type { UpgradeClickHouse, UpgradePostgres } from "./ports.ts";
import {
  gooseSteps,
  prismaSteps,
  readGooseVersions,
  readPrismaMigrations,
} from "./seed-sources.ts";

/**
 * Seeds the ledger from `_prisma_migrations` and `goose_db_version`, as one recorded seed run.
 * Every seeded step is inferred and carries no release; tenant summaries wait for S5.
 */
export class UpgradeLedgerSeedService {
  private constructor(
    private readonly postgres: UpgradePostgres,
    private readonly clickhouse: UpgradeClickHouse | undefined,
    private readonly ledger: UpgradeLedgerRepository,
  ) {}

  static create({
    postgres,
    clickhouse,
  }: {
    postgres: UpgradePostgres;
    /** Absent when the installation has no ClickHouse: only Prisma's history is read. */
    clickhouse?: UpgradeClickHouse;
  }): UpgradeLedgerSeedService {
    return new UpgradeLedgerSeedService(
      postgres,
      clickhouse,
      UpgradeLedgerRepository.create({ postgres }),
    );
  }

  async seed(): Promise<UpgradeRun> {
    await this.ledger.createTables();
    const run = await this.ledger.startRun({ kind: "seed" });
    try {
      const prisma = prismaSteps({ rows: await readPrismaMigrations({ postgres: this.postgres }) });
      const goose = this.clickhouse
        ? gooseSteps({ rows: await readGooseVersions({ clickhouse: this.clickhouse }) })
        : [];
      const written = await this.ledger.writeInferredSteps({
        runId: run.id,
        steps: [...prisma, ...goose],
      });
      return await this.ledger.finishRun({
        runId: run.id,
        outcome: "succeeded",
        report: { seeded: countByKind(written) },
      });
    } catch (error) {
      await this.ledger.finishRun({
        runId: run.id,
        outcome: "failed",
        report: { error: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }
  }
}

function countByKind(kinds: readonly UpgradeStepKind[]): Partial<Record<UpgradeStepKind, number>> {
  const counts: Partial<Record<UpgradeStepKind, number>> = {};
  for (const kind of kinds) counts[kind] = (counts[kind] ?? 0) + 1;
  return counts;
}

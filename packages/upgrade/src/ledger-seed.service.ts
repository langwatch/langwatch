import { UpgradeLedgerRepository } from "./ledger.repository.ts";
import type { InferredStep, UpgradeRun, UpgradeStep, UpgradeStepKind } from "./ledger.ts";
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
      const written = await this.ledger.writeInferredSteps({
        runId: run.id,
        steps: await this.readHistory(),
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

  /**
   * Re-reads the tools' records into every row still inferred, under the seed run that wrote it:
   * an installation upgraded by an image older than the ledger moves only those records.
   */
  async reinfer({ seedRunId }: { seedRunId: string }): Promise<void> {
    await this.ledger.writeInferredSteps({ runId: seedRunId, steps: await this.readHistory() });
  }

  /** Prisma's and goose's own history, as inferred steps. */
  async readHistory(): Promise<InferredStep[]> {
    const prisma = prismaSteps({ rows: await readPrismaMigrations({ postgres: this.postgres }) });
    const goose = this.clickhouse
      ? gooseSteps({ rows: await readGooseVersions({ clickhouse: this.clickhouse }) })
      : [];
    return [...prisma, ...goose];
  }
}

/**
 * The ledger as a re-inference would leave it: a row still inferred takes the tools' record, and
 * a step only the tools record joins. Spec: packages/upgrade/specs/ledger-seed.feature.
 */
export function withReinferred({
  steps,
  history,
}: {
  steps: readonly Pick<UpgradeStep, "id" | "status" | "inferred">[];
  history: readonly InferredStep[];
}): Pick<UpgradeStep, "id" | "status">[] {
  const recorded = new Map(history.map((step) => [step.id, step]));
  const known = new Set(steps.map((step) => step.id));
  return [
    ...steps.map((step) => {
      const fresh = step.inferred ? recorded.get(step.id) : undefined;
      return fresh ? { id: step.id, status: fresh.status } : { id: step.id, status: step.status };
    }),
    ...history.filter((step) => !known.has(step.id)).map(({ id, status }) => ({ id, status })),
  ];
}

function countByKind(kinds: readonly UpgradeStepKind[]): Partial<Record<UpgradeStepKind, number>> {
  const counts: Partial<Record<UpgradeStepKind, number>> = {};
  for (const kind of kinds) counts[kind] = (counts[kind] ?? 0) + 1;
  return counts;
}

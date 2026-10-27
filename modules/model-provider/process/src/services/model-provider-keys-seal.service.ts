import { createLogger } from "@langwatch/observability";

import type {
  ModelProviderLegacyColumns,
  ModelProviderRepository,
} from "../repositories/model-provider.repository.ts";
import { ModelProviderLegacyMigrationService } from "./model-provider-legacy-migration.service.ts";

const logger = createLogger("langwatch:model-provider:keys-seal");

/** What one pass did; the ledger keeps it. Counts and a row id, never a key. */
export type ModelProviderKeysSealReport = {
  afterId: string | null;
  updated: number;
  skipped: number;
};

type KeysSealStore = Pick<
  ModelProviderRepository,
  "findProjectScopedLegacyColumns" | "updateLegacyColumnsIfUnchanged"
>;

/**
 * Seals every plaintext `customKeys` (specs/model-providers/encrypt-custom-keys.feature).
 * Level-triggered: a sealed row plans as unchanged, so a second pass writes nothing. Writes
 * are guarded on `updatedAt`, so a save made during the pass keeps its newer keys.
 */
export class ModelProviderKeysSealService {
  static create(deps: { providers: KeysSealStore }): ModelProviderKeysSealService {
    return new ModelProviderKeysSealService(deps);
  }

  private constructor(private readonly deps: { providers: KeysSealStore }) {}

  async sealPlaintextKeys({
    dryRun,
    signal,
    afterId,
    onRowDone,
  }: {
    dryRun: boolean;
    signal: AbortSignal;
    afterId: string | null;
    onRowDone: (report: ModelProviderKeysSealReport) => Promise<void>;
  }): Promise<ModelProviderKeysSealReport> {
    const plans = ModelProviderLegacyMigrationService.create();
    const report: ModelProviderKeysSealReport = { afterId, updated: 0, skipped: 0 };
    let held = 0;
    const rows = (await this.deps.providers.findProjectScopedLegacyColumns())
      .filter((row) => afterId === null || row.id > afterId)
      .toSorted((a, b) => (a.id < b.id ? -1 : 1));
    for (const row of rows) {
      if (signal.aborted) break;
      const outcome = await this.sealRow({ plans, row, dryRun });
      if (outcome === "held") {
        held += 1;
        logger.warn(
          { modelProviderId: row.id },
          "model provider changed while its keys were sealed",
        );
        continue;
      }
      if (outcome === "unchanged") {
        report.skipped += 1;
        continue;
      }
      report.updated += 1;
      // Progress freezes before the first held row, so a retry revisits it.
      if (dryRun || held > 0) continue;
      report.afterId = row.id;
      await onRowDone({ ...report });
    }
    logger.info(
      { updated: report.updated, skipped: report.skipped, held, dryRun },
      "model provider key sealing pass finished",
    );
    if (held > 0) {
      throw new Error(
        `${held} model provider rows changed during the pass and still hold plaintext keys`,
      );
    }

    return report;
  }

  /** A refused write re-reads the row: sealed by the newer save, or held for a retry. */
  private async sealRow({
    plans,
    row,
    dryRun,
  }: {
    plans: ModelProviderLegacyMigrationService;
    row: ModelProviderLegacyColumns;
    dryRun: boolean;
  }): Promise<"sealed" | "unchanged" | "held"> {
    const seal = plans.planModelProviderKeysSeal({ row });
    if (seal.outcome === "unchanged") return "unchanged";
    if (dryRun) return "sealed";
    const written = await this.deps.providers.updateLegacyColumnsIfUnchanged({
      id: row.id,
      customKeys: seal.keys,
      updatedAt: row.updatedAt,
    });
    if (written) return "sealed";
    // Refusals are rare, so this re-reads the listing rather than adding a by-id read.
    const reread = (await this.deps.providers.findProjectScopedLegacyColumns()).find(
      (candidate) => candidate.id === row.id,
    );
    if (reread === undefined) return "unchanged";

    return plans.planModelProviderKeysSeal({ row: reread }).outcome === "unchanged"
      ? "unchanged"
      : "held";
  }
}

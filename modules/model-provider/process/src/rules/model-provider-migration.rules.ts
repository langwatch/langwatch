/**
 * What both one-off ModelProvider migrations share: the table shape they
 * walk and the outcome shape they report. Per-row conversions live in
 * `#services/model-provider-legacy-migration.service`; this is only the walk's vocabulary.
 */
import type { ModelProviderRepository } from "../repositories/model-provider.repository.ts";

/** Exactly the repository operations these migrations perform, and nothing else. */
export type ModelProviderMigrationDatabase = Pick<
  ModelProviderRepository,
  "findProjectScopedLegacyColumns" | "updateLegacyColumns"
>;

/** What one migration did, so the caller can report it and a deploy can read it. */
export type ModelProviderMigrationOutcome = {
  updated: number;
  skipped: number;
};

/**
 * What both one-off ModelProvider migrations share: the table shape they
 * walk and the outcome shape they report. The per-row conversions
 * (`migrateCustomModelsRow`, `migrateModelProviderKeysRow`) live in
 * `#services/model-provider-legacy-migration.service`, since neither task
 * here decides anything about a row — this module is only the walk's common
 * vocabulary.
 */

/** Exactly the operations these migrations perform, and nothing else. */
export type ModelProviderMigrationDatabase = {
  project: { findMany(args: { select: { id: true } }): Promise<{ id: string }[]> };
  modelProvider: {
    findMany(args: {
      where: { scopes: { some: { scopeType: "PROJECT"; scopeId: string } } };
      select: Record<string, true>;
    }): Promise<Record<string, unknown>[]>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
};

/** What one migration did, so the caller can report it and a deploy can read it. */
export type ModelProviderMigrationOutcome = {
  updated: number;
  skipped: number;
};

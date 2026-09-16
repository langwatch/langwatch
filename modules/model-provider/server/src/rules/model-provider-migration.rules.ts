/**
 * What both one-off ModelProvider migrations share: the table shape they
 * walk and the outcome shape they report. Per-row conversions live in
 * `#services/model-provider-legacy-migration.service`; this is only the walk's vocabulary.
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

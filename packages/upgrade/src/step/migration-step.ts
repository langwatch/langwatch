import { z } from "zod";

import { upgradeStepKindSchema, upgradeStepModeSchema } from "../ledger.ts";

/**
 * The kinds a module declares with `.withMigrations` (rethink 6.1). A subset of the ledger's
 * kinds, so a new declared kind is one more ledger kind first; SQL kinds come from their files.
 */
export const migrationStepKindSchema = upgradeStepKindSchema.extract([
  "data",
  "tenant",
  "procedure",
]);
export type MigrationStepKind = z.infer<typeof migrationStepKindSchema>;

/** `<module>:<kebab-name>`, the declaring module first (blitz plan 5.3). */
const MIGRATION_STEP_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*:[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** What a step reports, kept by the ledger as its checkpoint report (rethink 6.6). */
export const migrationStepReportSchema = z.record(z.string(), z.unknown());
export type MigrationStepReport = z.infer<typeof migrationStepReportSchema>;

/** Every field of a declared step but its run function, which no schema can state. */
export const migrationStepDeclarationSchema = z.object({
  id: z.string().regex(MIGRATION_STEP_ID),
  kind: migrationStepKindSchema,
  mode: upgradeStepModeSchema,
  description: z.string().trim().min(1),
  needsOldWritersGone: z.boolean().optional(),
});
export type MigrationStepDeclaration = z.infer<typeof migrationStepDeclarationSchema>;

/** Where a resumed run starts and how it records progress; the runner keeps both in the ledger. */
export interface MigrationStepCheckpoint {
  /** The report the last attempt saved, or null on a first run. */
  readonly resumeFrom: MigrationStepReport | null;
  save(args: { report: MigrationStepReport }): Promise<void>;
}

/** Idempotent and level-triggered: a second full run changes nothing (rethink 6.11). */
export type MigrationStepRun = (args: {
  checkpoint: MigrationStepCheckpoint;
  dryRun: boolean;
  signal: AbortSignal;
}) => Promise<MigrationStepReport>;

export type MigrationStep = Readonly<MigrationStepDeclaration & { run: MigrationStepRun }>;

export type MigrationStepRefusal = "malformed_id" | "missing_description" | "blocking_not_data";

/** A step its own declaration refuses; `module` and `step` name it for boot's message. */
export class MigrationStepDeclarationError extends Error {
  readonly code = "migration_step_declaration_refused";
  readonly step: string;
  readonly refusal: MigrationStepRefusal;
  constructor({
    step,
    refusal,
    detail,
  }: {
    step: string;
    refusal: MigrationStepRefusal;
    detail: string;
  }) {
    super(`Migration step "${step}" of module "${moduleOf(step)}" is refused: ${detail}`);
    this.name = "MigrationStepDeclarationError";
    this.step = step;
    this.refusal = refusal;
  }

  get module(): string {
    return moduleOf(this.step);
  }
}

/** Declares one code step; refuses by name an id, description or mode the rules forbid. */
export function defineMigrationStep(
  step: MigrationStepDeclaration & { run: MigrationStepRun },
): MigrationStep {
  if (!MIGRATION_STEP_ID.test(step.id)) {
    throw new MigrationStepDeclarationError({
      step: step.id,
      refusal: "malformed_id",
      detail: `an id is "<module>:<kebab-name>", the declaring module first.`,
    });
  }
  if (step.description.trim().length === 0) {
    throw new MigrationStepDeclarationError({
      step: step.id,
      refusal: "missing_description",
      detail: "every step states in one line what it does; ops shows it before the step runs.",
    });
  }
  if (step.mode === "blocking" && step.kind !== "data") {
    throw new MigrationStepDeclarationError({
      step: step.id,
      refusal: "blocking_not_data",
      detail: `it is blocking but of kind "${step.kind}"; only a data step blocks (frozen SQL).`,
    });
  }
  return Object.freeze({ ...migrationStepDeclarationSchema.parse(step), run: step.run });
}

/** The guard `packages/process` collects with, as tasks are collected with `isTask`. */
export function isMigrationStep(value: unknown): value is MigrationStep {
  if (typeof value !== "object" || value === null) return false;
  if (!("run" in value) || typeof value.run !== "function") return false;
  const declared = migrationStepDeclarationSchema.safeParse(value);
  if (!declared.success) return false;
  return declared.data.mode !== "blocking" || declared.data.kind === "data";
}

function moduleOf(step: string): string {
  return step.split(":")[0] ?? step;
}

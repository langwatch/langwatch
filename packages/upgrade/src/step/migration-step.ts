import type { SystemMigration } from "@langwatch/system-migrations";
import { z } from "zod";

import { upgradeStepKindSchema, upgradeStepModeSchema } from "../ledger.ts";
import type { CodeStepId } from "./code-step-ids.generated.ts";

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
  /** The background steps this one runs after, by id; declared as the step values themselves. */
  after: z.array(z.string().regex(MIGRATION_STEP_ID)).optional(),
});
export type MigrationStepDeclaration = z.infer<typeof migrationStepDeclarationSchema>;

/** The tenants a tenant step walks, one at a time, paged from the pass's source for each. */
export const tenantAxisSchema = z.enum(["organization", "project", "user"]);
export type TenantAxis = z.infer<typeof tenantAxisSchema>;

const { id, mode, description, needsOldWritersGone } = migrationStepDeclarationSchema.shape;

/** A tenant step's pacing, flat on its declaration and on no other kind (S6-4, 2026-10-09). */
export const tenantMigrationStepDeclarationSchema = z.object({
  id,
  kind: z.literal("tenant"),
  mode,
  description,
  needsOldWritersGone,
  tenants: tenantAxisSchema,
  title: z.string().trim().min(1),
  requiresOperatorConfirmation: z.boolean(),
  runsAutomaticallyOnSelfHosted: z.boolean(),
  enrolledAutomatically: z.boolean(),
});
export type TenantMigrationStepDeclaration = z.infer<typeof tenantMigrationStepDeclarationSchema>;

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

/** One tenant at a time; the framework keeps each tenant's state (Alex, 2026-10-09, S6-1). */
type TenantStepWork = Pick<SystemMigration, "migrateTenant" | "candidateTenants">;

export type TenantMigrationStep = Readonly<TenantMigrationStepDeclaration & TenantStepWork>;

export type TenantMigrationStepDefinition = TenantMigrationStepDeclaration & TenantStepWork;

export type MigrationStepRefusal =
  | "malformed_id"
  | "missing_description"
  | "blocking_not_data"
  | "after_not_background";

/**
 * What a module writes: `after` names step values or, across modules, a generated `CodeStepId`
 * (Alex, 2026-10-09, STEP-AFTER-2), so a missing or mistyped step fails typecheck.
 */
export type MigrationStepDefinition = Omit<MigrationStepDeclaration, "after" | "kind"> & {
  kind: Exclude<MigrationStepKind, "tenant">;
  after?: readonly (MigrationStep | CodeStepId)[];
  run: MigrationStepRun;
};

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
export function defineMigrationStep(step: TenantMigrationStepDefinition): TenantMigrationStep;
export function defineMigrationStep(step: MigrationStepDefinition): MigrationStep;
export function defineMigrationStep(
  step: TenantMigrationStepDefinition | MigrationStepDefinition,
): TenantMigrationStep | MigrationStep {
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
  if (step.kind === "tenant") {
    const declared = tenantMigrationStepDeclarationSchema.parse(step);
    const candidates = step.candidateTenants ? { candidateTenants: step.candidateTenants } : {};
    return Object.freeze({ ...declared, ...candidates, migrateTenant: step.migrateTenant });
  }
  const after = step.after?.map((named) => (typeof named === "string" ? named : named.id));
  const values = step.after?.filter((named) => typeof named !== "string") ?? [];
  if (after && [step, ...values].some((each) => each.mode !== "background")) {
    throw new MigrationStepDeclarationError({
      step: step.id,
      refusal: "after_not_background",
      detail: `only a background step runs after others, and only after background steps (${after.join(", ")}).`,
    });
  }
  const declared = migrationStepDeclarationSchema.parse({ ...step, after });
  return Object.freeze({ ...declared, run: step.run });
}

/** The guard `packages/process` collects with, as tasks are collected with `isTask`. */
export function isMigrationStep(value: unknown): value is MigrationStep {
  if (typeof value !== "object" || value === null) return false;
  if (!("run" in value) || typeof value.run !== "function") return false;
  const declared = migrationStepDeclarationSchema.safeParse(value);
  if (!declared.success) return false;
  return declared.data.mode !== "blocking" || declared.data.kind === "data";
}

/** A tenant step: its pacing parses and it migrates one tenant at a time. */
export function isTenantMigrationStep(value: unknown): value is TenantMigrationStep {
  if (typeof value !== "object" || value === null) return false;
  if (!("migrateTenant" in value) || typeof value.migrateTenant !== "function") return false;
  const declared = tenantMigrationStepDeclarationSchema.safeParse(value);
  return declared.success && declared.data.mode !== "blocking";
}

function moduleOf(step: string): string {
  return step.split(":")[0] ?? step;
}

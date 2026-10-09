/**
 * A module's migration steps, declared with `.withMigrations` and collected over the installed
 * list as tasks are. The kernel cannot name `@langwatch/upgrade`'s step, so the caller's guard
 * narrows it. Spec: packages/process/specs/module-migrations.feature.
 */
import type { InstalledFeatureState, ServerRole } from "../feature-installer.ts";

/** Tasks runs blocking steps, the worker background ones; the api builds them only to feed ops. */
export function buildsMigrationSteps(role: ServerRole): boolean {
  return role === "tasks" || role === "worker";
}

export type MigrationStepCollectionRefusal = "not_a_step" | "foreign_prefix" | "duplicate_id";

/** A declared step the installed list refuses, naming its module and, its id if any. */
export class MigrationStepCollectionError extends Error {
  readonly code = "migration_step_collection_refused";
  readonly module: string;
  readonly step: string | undefined;
  readonly refusal: MigrationStepCollectionRefusal;
  constructor({
    module,
    step,
    refusal,
    detail,
  }: {
    module: string;
    step: string | undefined;
    refusal: MigrationStepCollectionRefusal;
    detail: string;
  }) {
    const named = step ? `migration step "${step}"` : "a migration step";
    super(`Module "${module}" declares ${named} that is refused: ${detail}`);
    this.name = "MigrationStepCollectionError";
    this.module = module;
    this.step = step;
    this.refusal = refusal;
  }
}

/** Every declared step in installation order; refuses a foreign prefix or a repeated id. */
export function collectMigrationSteps<Step extends { readonly id: string }>({
  declared,
  isMigrationStep,
}: {
  declared: readonly { readonly module: string; readonly steps: readonly unknown[] }[];
  isMigrationStep: (contribution: unknown) => contribution is Step;
}): readonly Step[] {
  const collected: Step[] = [];
  const seen = new Set<string>();
  for (const { module, steps } of declared) {
    for (const step of steps) {
      if (!isMigrationStep(step)) {
        throw new MigrationStepCollectionError({
          module,
          step: idOf(step),
          refusal: "not_a_step",
          detail:
            "withMigrations accepted something that is not a step made with defineMigrationStep.",
        });
      }
      if (!step.id.startsWith(`${module}:`)) {
        throw new MigrationStepCollectionError({
          module,
          step: step.id,
          refusal: "foreign_prefix",
          detail: `a step id starts with its declaring module, as "${module}:<kebab-name>".`,
        });
      }
      if (seen.has(step.id)) {
        throw new MigrationStepCollectionError({
          module,
          step: step.id,
          refusal: "duplicate_id",
          detail: "the id is declared twice; it is the ledger key and is never reused.",
        });
      }
      seen.add(step.id);
      collected.push(step);
    }
  }
  return collected;
}

/** What a booted process answers for its migration steps: tasks and worker only. */
export function migrationStepsOf<Step extends { readonly id: string }>({
  process,
  role,
  installed,
  isMigrationStep,
}: {
  process: string;
  role: ServerRole;
  installed: ReadonlyMap<string, InstalledFeatureState>;
  isMigrationStep: (contribution: unknown) => contribution is Step;
}): readonly Step[] {
  if (!buildsMigrationSteps(role)) {
    throw new Error(
      `Asked "${process}" for its migration steps, but only the "tasks" and "worker" roles ` +
        `build them and this process is "${role}".`,
    );
  }
  const declared = [...installed].map(([module, state]) => ({
    module,
    steps: state.migrationSteps ?? [],
  }));
  return collectMigrationSteps({ declared, isMigrationStep });
}

function idOf(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("id" in value)) return undefined;
  return typeof value.id === "string" ? value.id : undefined;
}

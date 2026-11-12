import { duplicateGooseVersions } from "../manifest/stamp.ts";
import type { RegisteredStep } from "./runner-ledger.repository.ts";
import { UpgradeRunFailure } from "./upgrade-outcome.ts";

export interface DuplicateStep {
  id: string;
  sources: string[];
}

const sourceOf = (step: RegisteredStep) =>
  `${step.release ?? "the image's tree"} (${step.description})`;

/**
 * Every id the shipped list names more than once, each with what ships it: the goose files when
 * their shared prefix is the cause, else each step's release and description.
 * Spec: packages/upgrade/specs/duplicate-steps.feature.
 */
export function duplicateSteps({
  steps,
  gooseFiles = [],
}: {
  steps: readonly RegisteredStep[];
  gooseFiles?: readonly string[];
}): DuplicateStep[] {
  const stepsById = new Map<string, RegisteredStep[]>();
  for (const step of steps) stepsById.set(step.id, [...(stepsById.get(step.id) ?? []), step]);
  const filesById = new Map(
    duplicateGooseVersions({ gooseFiles }).map(({ id, files }) => [id, files]),
  );
  return [...stepsById]
    .filter(([, named]) => named.length > 1)
    .map(([id, named]) => ({ id, sources: filesById.get(id) ?? named.map(sourceOf) }));
}

/** Preflight's refusal: the ledger registers every shipped step in one statement, by id. */
export function duplicateStepFailure({
  duplicates,
}: {
  duplicates: readonly DuplicateStep[];
}): UpgradeRunFailure {
  const named = duplicates.map(({ id, sources }) => `${id} by ${sources.join(" and ")}`);
  return new UpgradeRunFailure(
    "duplicate_step",
    `this image ships one step id twice: ${named.join("; ")}. ` +
      "Give each migration its own prefix, then build the image again",
    { steps: duplicates.map(({ id, sources }) => ({ id, sources: [...sources] })) },
  );
}

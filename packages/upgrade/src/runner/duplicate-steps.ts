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
 * Every id the shipped list names twice, and every goose version two files share even when a
 * manifest already holds it, each with its sources: the files, else release and description.
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
  const byFiles = duplicateGooseVersions({ gooseFiles }).map(({ id, files }) => ({
    id,
    sources: files,
  }));
  const byFileIds = new Set(byFiles.map(({ id }) => id));
  const bySteps = [...stepsById]
    .filter(([id, named]) => named.length > 1 && !byFileIds.has(id))
    .map(([id, named]) => ({ id, sources: named.map(sourceOf) }));
  return [...byFiles, ...bySteps];
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
      "Give each named migration file or declared step its own id, then build the image again",
    { steps: duplicates.map(({ id, sources }) => ({ id, sources: [...sources] })) },
  );
}

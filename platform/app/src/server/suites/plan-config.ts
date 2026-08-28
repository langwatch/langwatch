/**
 * A run plan's config, and the keys that compare two of them.
 *
 * A run plan is a NAME plus a config. The name is the plan's identity: a run
 * started under a name joins the plan of that name and replaces its config, or
 * creates the plan when nothing answers. The keys here never take part in that
 * identity. They answer a different question: "which stored configurations does
 * this scope already have history for", which the run dialog's Run name
 * autocomplete reads.
 *
 * So: two plans may hold the SAME config and differ only by name. Nothing may
 * derive a plan's id or slug from a config key.
 *
 * @see specs/suites/run-plan-identity-by-name.feature
 */

import type { PrismaClient } from "~/generated/prisma/client";
import type { RunParameterValues } from "~/server/scenarios/parameters";
import { type SuiteScope, suiteScopeSchema } from "./scope";
import type { SuiteTarget } from "./types";

/** Everything a run plan holds beside its name. */
export type PlanConfig = {
  scope: SuiteScope;
  targets: SuiteTarget[];
  repeatCount: number;
  simulatorModel: string | null;
  judgeModel: string | null;
};

/**
 * Orders targets so "dev vs prod" and "prod vs dev" are one config.
 *
 * Stable and total: `type` then `referenceId`, both of which every target
 * carries. Comparison columns therefore keep their order between runs of the
 * same plan.
 */
export function sortSuiteTargets(targets: SuiteTarget[]): SuiteTarget[] {
  return [...targets].sort((left, right) =>
    targetKey(left).localeCompare(targetKey(right)),
  );
}

/** `<type>:<referenceId>`. The whole of a target's identity. */
function targetKey(target: SuiteTarget): string {
  return `${target.type}:${target.referenceId}`;
}

/**
 * What a scope covers, as one comparable string.
 *
 * `cases` folds in the scenario ids, which the scope shape itself does not
 * carry (they live in `SimulationSuite.scenarioIds`). Without them two
 * hand-picked scopes over different scenarios would take the same key and offer
 * each other the wrong history.
 */
export function scopeKey(params: {
  scope: SuiteScope;
  scenarioIds?: string[];
}): string {
  const { scope } = params;
  switch (scope.mode) {
    case "all":
      return "all";
    case "folders":
      return `folders:${sortedList(scope.folderIds)}`;
    case "labels":
      return `labels:${sortedList(scope.labels)}`;
    case "cases":
      return `cases:${sortedList(params.scenarioIds ?? [])}`;
  }
}

/**
 * One configuration, as one comparable string.
 *
 * Configuration identity is WIDER than plan identity: one plan run twice with
 * different parameters, or a different repeat count, is two configurations and
 * both are listed. The run NOTE is never part of it, and is never carried over.
 *
 * The recipe is shared with the run dialog, which rebuilds the same string to
 * mark the entry matching what it currently holds, so the field order and the
 * separators below are a contract and not an implementation detail.
 */
export function configurationKey(params: {
  config: PlanConfig;
  scenarioIds?: string[];
  parameters?: RunParameterValues;
}): string {
  const { config } = params;
  return [
    scopeKey({ scope: config.scope, scenarioIds: params.scenarioIds }),
    sortSuiteTargets(config.targets).map(targetKey).join("+"),
    `x${config.repeatCount}`,
    config.simulatorModel ?? "",
    config.judgeModel ?? "",
    parametersKey(params.parameters),
  ].join("|");
}

/**
 * The parameter overrides a run was started with, as `k=v` pairs.
 *
 * A parameter value is a string, a number or a boolean, so the key states the
 * value the way JavaScript prints it. A number and the string of that number
 * therefore take one key, which is correct here: both name the same run.
 */
export function parametersKey(
  parameters: RunParameterValues | undefined,
): string {
  return Object.entries(parameters ?? {})
    .map(([name, value]) => `${name}=${value}`)
    .sort()
    .join(",");
}

function sortedList(values: string[]): string {
  return [...new Set(values)].sort().join(",");
}

/**
 * Reduces a scope to the one form the project agrees on.
 *
 * A `folders` scope naming every non-archived folder of the project IS every
 * scenario of the project, because no scenario is loose any more, so it
 * normalises to `all`. Without this, hand-picking every suite and pressing Run
 * all would land on two different plans that always run the same thing.
 *
 * This needs the project, so it cannot live in a scope-only helper. Normalise
 * when the config is built, before the key is taken and before it is stored.
 *
 * A `folders` scope naming NO folder is left alone: an empty pick is not
 * everything.
 */
export async function normalizePlanScope(params: {
  projectId: string;
  scope: SuiteScope;
  prisma: PrismaClient;
}): Promise<SuiteScope> {
  const { scope } = params;
  if (scope.mode !== "folders") return scope;

  const named = new Set(scope.folderIds);
  if (named.size === 0) return { mode: "folders", folderIds: [] };

  const folders = await params.prisma.simulationSuite.findMany({
    where: {
      projectId: params.projectId,
      kind: "folder",
      archivedAt: null,
    },
    select: { id: true },
  });
  // An archived folder holds no active scenario, so a scope may be exhaustive
  // without naming it.
  const coversEveryFolder =
    folders.length > 0 && folders.every((folder) => named.has(folder.id));

  return coversEveryFolder
    ? { mode: "all" }
    : { mode: "folders", folderIds: [...named].sort() };
}

/** Reads a stored scope back, refusing nothing: see parseSuiteScope. */
export function planScopeOrNull(raw: unknown): SuiteScope | null {
  const parsed = suiteScopeSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

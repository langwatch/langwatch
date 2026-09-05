/**
 * What one run was configured with, read back off the run itself.
 * @see specs/features/agent-testing/results-tabs.feature
 * @see specs/scenarios/run-configuration-on-runs.feature
 */

import { targetKeyOfRun } from "@langwatch/suite-web";
import type { RunActor, ScenarioRunData } from "@langwatch/scenario-contract";

/** One resolved run parameter, as the block prints it. */
export type RunSettingParameter = {
  name: string;
  value: string;
};

export type RunSettings = {
  /** Sorted by name, so two runs of one plan read in the same order. */
  parameters: RunSettingParameter[];
  /**
   * Every parameter each target received, keyed by target key and sorted by
   * name. A comparison reads these beside each target, in place of the
   * Parameters row.
   */
  parametersByTarget: Map<string, RunSettingParameter[]>;
  /** How many times each scenario and target pair ran. One when it ran once. */
  repeatCount: number;
  /** Null only on a run recorded before the models were stamped. */
  simulatorModel: string | null;
  /** Null only on a run recorded before the models were stamped. */
  judgeModel: string | null;
  /**
   * Who started the run, or null when the run records no person. A run
   * started with a project key, and a run recorded before the actor was
   * stamped, both read as null and print no name.
   */
  actor: RunActor | null;
  /**
   * The connected agent instance that served each target, keyed by target
   * key. Only a connected agent records one, so every other target is absent
   * and its line names no instance.
   */
  instanceByTarget: Map<string, string>;
};

/**
 * The run-level parameter values of a batch.
 */
function readParameters(scenarioRuns: ScenarioRunData[]): RunSettingParameter[] {
  const valueByName = new Map<string, string>();
  for (const run of scenarioRuns) {
    const overridden = new Set(Object.keys(run.metadata?.langwatch?.targetParameters ?? {}));
    for (const parameter of parametersOfRun(run)) {
      if (overridden.has(parameter.name)) continue;
      if (valueByName.has(parameter.name)) continue;
      valueByName.set(parameter.name, parameter.value);
    }
  }
  return [...valueByName]
    .map(([name, value]) => ({ name, value }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

/** The parameters of one run as the block prints them, sorted by name. */
function parametersOfRun(run: ScenarioRunData): RunSettingParameter[] {
  const raw = run.metadata?.parameters;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return [];
  return Object.entries(raw)
    .filter(
      ([, value]) =>
        typeof value === "string" || typeof value === "number" || typeof value === "boolean",
    )
    .map(([name, value]) => ({ name, value: String(value) }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * The full set of values each target received, over every run of it.
 */
function readParametersByTarget(
  scenarioRuns: ScenarioRunData[],
): Map<string, RunSettingParameter[]> {
  const byTarget = new Map<string, Map<string, string>>();
  for (const run of scenarioRuns) {
    const key = targetKeyOfRun(run);
    if (!key) continue;
    const values = byTarget.get(key) ?? new Map<string, string>();
    for (const parameter of parametersOfRun(run)) {
      if (!values.has(parameter.name)) values.set(parameter.name, parameter.value);
    }
    byTarget.set(key, values);
  }
  return new Map(
    [...byTarget]
      .filter(([, values]) => values.size > 0)
      .map(([key, values]) => [
        key,
        [...values]
          .map(([name, value]) => ({ name, value }))
          .sort((left, right) => left.name.localeCompare(right.name)),
      ]),
  );
}

/**
 * How many times the batch ran each scenario against each target.
 */
function readRepeatCount(scenarioRuns: ScenarioRunData[]): number {
  const counts = new Map<string, number>();
  for (const run of scenarioRuns) {
    const targetKey = targetKeyOfRun(run) ?? "";
    const key = `${run.scenarioId}::${targetKey}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Math.max(1, ...counts.values());
}

/**
 * The model the batch ran on: the first run that names one.
 */
function readModel(
  scenarioRuns: ScenarioRunData[],
  field: "simulatorModel" | "judgeModel",
): string | null {
  const resolvedField =
    field === "simulatorModel"
      ? ("resolvedSimulatorModel" as const)
      : ("resolvedJudgeModel" as const);
  for (const run of scenarioRuns) {
    const model = run.metadata?.langwatch?.[resolvedField];
    if (model) return model;
  }
  for (const run of scenarioRuns) {
    const model = run.metadata?.langwatch?.[field];
    if (model) return model;
  }
  return null;
}

/**
 * Who started the batch: the first run that names a person.
 * @see specs/scenarios/run-actor-on-runs.feature
 */
function readActor(scenarioRuns: ScenarioRunData[]): RunActor | null {
  for (const run of scenarioRuns) {
    const id = run.metadata?.langwatch?.actorId;
    const label = run.metadata?.langwatch?.actorLabel;
    if (id && label) return { id, label };
  }
  return null;
}

/**
 * What the settings row calls the person who started the run.
 */
export function runActorName({
  actor,
  viewerUserId,
  memberNameById,
}: {
  actor: RunActor | null;
  viewerUserId: string | null | undefined;
  /** The name each organization member goes by, keyed by their user id. */
  memberNameById?: Map<string, string>;
}): string | null {
  if (!actor) return null;
  if (actor.label === "api") return "API";
  if (actor.label === "cli") return "CLI";
  if (actor.id === viewerUserId) return "You";
  return memberNameById?.get(actor.id) ?? null;
}

/**
 * The connected agent instance that answered each target's runs (ADR-128).
 */
function readInstanceByTarget(scenarioRuns: ScenarioRunData[]): Map<string, string> {
  const byTarget = new Map<string, string>();
  for (const run of scenarioRuns) {
    const key = targetKeyOfRun(run);
    if (!key || byTarget.has(key)) continue;
    const served = (
      run.metadata?.langwatch as
        | { agentInstance?: { hostname?: string; label?: string | null } }
        | undefined
    )?.agentInstance;
    if (!served?.hostname) continue;
    byTarget.set(key, served.label ? `${served.hostname} (${served.label})` : served.hostname);
  }
  return byTarget;
}

/** Everything the run settings block reads, or null when the batch is empty. */
export function readRunSettings(scenarioRuns: ScenarioRunData[]): RunSettings | null {
  if (scenarioRuns.length === 0) return null;
  return {
    parameters: readParameters(scenarioRuns),
    parametersByTarget: readParametersByTarget(scenarioRuns),
    repeatCount: readRepeatCount(scenarioRuns),
    simulatorModel: readModel(scenarioRuns, "simulatorModel"),
    judgeModel: readModel(scenarioRuns, "judgeModel"),
    actor: readActor(scenarioRuns),
    instanceByTarget: readInstanceByTarget(scenarioRuns),
  };
}

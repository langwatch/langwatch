/**
 * What one run was configured with, read back off the run itself.
 *
 * A run says how it scored. It must also say what it was, so a person
 * comparing run 2 with run 3 can see which setting moved the number. Every
 * part of that is already stamped on the queued run: the two simulation
 * models sit in the reserved `langwatch` namespace of the run metadata, the
 * resolved parameters sit beside it, and the repeat count is the number of
 * runs of one batch that share a scenario and a target.
 *
 * Who started the run is stamped on it the same way, in the reserved
 * `langwatch` namespace. A run started by a project key names no person and
 * reads back as none.
 *
 * A model reads back as the value the plan was CONFIGURED with, which is
 * absent when the plan named none. A run recorded before the models were
 * stamped is absent for the same reason and reads the same way: this
 * configuration named no model. It never reads as the project default,
 * because the default at read time is not what the run took.
 *
 * The run NOTE is not here. It reads in the header line and does not move.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 * @see specs/scenarios/run-configuration-on-runs.feature
 */

import type { RunActor } from "~/server/scenarios/run-actor";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";

/** One resolved run parameter, as the block prints it. */
export type RunSettingParameter = {
  name: string;
  value: string;
};

export type RunSettings = {
  /** Sorted by name, so two runs of one plan read in the same order. */
  parameters: RunSettingParameter[];
  /** How many times each scenario and target pair ran. One when it ran once. */
  repeatCount: number;
  /** Null when the run names no simulator model. */
  simulatorModel: string | null;
  /** Null when the run names no judge model. */
  judgeModel: string | null;
  /**
   * Who started the run, or null when the run records no person. A run
   * started with a project key, and a run recorded before the actor was
   * stamped, both read as null and print no name.
   */
  actor: RunActor | null;
};

/**
 * The parameter values of a batch: the first run that carries any.
 *
 * A person who sets a parameter in the run dialog sets it for every scenario,
 * so a run of the batch that carries values carries the ones they chose.
 * Values only differ between scenarios for defaults nobody set.
 */
function readParameters(
  scenarioRuns: ScenarioRunData[],
): RunSettingParameter[] {
  for (const run of scenarioRuns) {
    const raw = run.metadata?.parameters;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) continue;

    const parameters = Object.entries(raw)
      .filter(
        ([, value]) =>
          typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean",
      )
      .map(([name, value]) => ({ name, value: String(value) }))
      .sort((left, right) => left.name.localeCompare(right.name));

    if (parameters.length > 0) return parameters;
  }
  return [];
}

/**
 * How many times the batch ran each scenario against each target.
 *
 * The largest group answers for the batch: a scenario that was cancelled
 * before its later iterations started would otherwise pull the count under
 * what the run was started with.
 */
function readRepeatCount(scenarioRuns: ScenarioRunData[]): number {
  const counts = new Map<string, number>();
  for (const run of scenarioRuns) {
    const targetId = run.metadata?.langwatch?.targetReferenceId ?? "";
    const key = `${run.scenarioId}::${targetId}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Math.max(1, ...counts.values());
}

/** The first run of the batch that names the model, or null. */
function readModel(
  scenarioRuns: ScenarioRunData[],
  field: "simulatorModel" | "judgeModel",
): string | null {
  for (const run of scenarioRuns) {
    const model = run.metadata?.langwatch?.[field];
    if (model) return model;
  }
  return null;
}

/**
 * Who started the batch: the first run that names a person.
 *
 * Every run of a batch is stamped with the same actor at queue time, so the
 * first one to carry it answers for the batch.
 *
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
 *
 * A run the reader started themselves reads as "You", which is how the rest
 * of the product names them. The two key surfaces name themselves. A run
 * started by another person names no one: the run stores an id, and a name is
 * never made up from an id.
 */
export function runActorName({
  actor,
  viewerUserId,
}: {
  actor: RunActor | null;
  viewerUserId: string | null | undefined;
}): string | null {
  if (!actor) return null;
  if (actor.label === "api") return "API";
  if (actor.label === "cli") return "CLI";
  return actor.id === viewerUserId ? "You" : null;
}

/** Everything the run settings block reads, or null when the batch is empty. */
export function readRunSettings(
  scenarioRuns: ScenarioRunData[],
): RunSettings | null {
  if (scenarioRuns.length === 0) return null;
  return {
    parameters: readParameters(scenarioRuns),
    repeatCount: readRepeatCount(scenarioRuns),
    simulatorModel: readModel(scenarioRuns, "simulatorModel"),
    judgeModel: readModel(scenarioRuns, "judgeModel"),
    actor: readActor(scenarioRuns),
  };
}

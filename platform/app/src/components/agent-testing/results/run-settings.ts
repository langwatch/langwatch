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
 * A model reads back as the model the run RESOLVED, which is the plan's
 * choice, or the case's own choice, or the project default of the moment the
 * run was queued. That is the one a person needs after the fact, because the
 * project default of today is not always the model the run took. A run
 * recorded before the resolved models were stamped falls back to the value its
 * plan was configured with, and reads as nothing when the plan named none.
 *
 * The run NOTE is not here. It reads in the header line and does not move.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 * @see specs/scenarios/run-configuration-on-runs.feature
 */

import { targetKeyOfRun } from "~/components/suites/run-history-transforms";
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
};

/**
 * The run-level parameter values of a batch: the first run that carries any.
 *
 * A person who sets a parameter in the run dialog sets it for every scenario,
 * so a run of the batch that carries values carries the ones they chose.
 * Values only differ between scenarios for defaults nobody set.
 *
 * A run carries the values its target resolved, which are the run-level
 * values with the target's own overrides on top. The overrides are taken back
 * out: they belong to the target, and the Targets row reads them beside the
 * target they belong to.
 */
function readParameters(
  scenarioRuns: ScenarioRunData[],
): RunSettingParameter[] {
  for (const run of scenarioRuns) {
    const raw = run.metadata?.parameters;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) continue;
    const overridden = new Set(
      Object.keys(run.metadata?.langwatch?.targetParameters ?? {}),
    );

    const parameters = Object.entries(raw)
      .filter(([name]) => !overridden.has(name))
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
 *
 * A target is its key, so the same agent on two sets of parameters is two
 * targets and a scenario that ran once against each is not a repeat.
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
 *
 * The resolved model answers first, because it is the model that really ran.
 * The configured model answers for a run recorded before resolved models were
 * stamped, and such a run names one only when its plan did.
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
 * The two key surfaces name themselves. A run the reader started reads as
 * "You", which is how the rest of the product names them. Any other person
 * reads by the name their organization membership holds, because on a shared
 * project most runs were started by somebody else and a blank row would hide
 * the answer exactly when it is wanted.
 *
 * The name is resolved for display only. The run stores the id, so a run from
 * last month still points at the right person after a rename.
 *
 * An id no membership holds reads as nothing at all. A name is never made up
 * from an id, and the row never carries a placeholder.
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

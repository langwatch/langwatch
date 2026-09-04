import type { PrismaClient } from "~/generated/prisma/client";
import {
  parseRunParametersJson,
  type RunParameterValues,
  withoutParameterNames,
} from "~/server/scenarios/parameters";
import { configurationKey } from "~/server/suites/plan-config";
import { parseSuiteScope, type SuiteScope } from "~/server/suites/scope";
import { getSuiteSetId } from "~/server/suites/suite-set-id";
import {
  hasParameterOverrides,
  splitTargetKey,
  targetKeyOf,
} from "~/server/suites/target-key";
import { type SuiteTarget, suiteTargetSchema } from "~/server/suites/types";
import type { ResultsFilter } from "../result-atoms/atom.types";
import type {
  RunConfigurationEntry,
  RunConfigurationScope,
} from "./run-configuration.types";
import {
  MAX_RUN_CONFIGURATIONS,
  type RawRunConfigurationRow,
  type RunConfigurationsClickHouseRepository,
} from "./run-configurations.clickhouse.repository";

/** How far back a configuration is still offered, in days. */
export const RUN_CONFIGURATION_WINDOW_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The default window, as a start timestamp. */
export function defaultConfigurationWindowStart(now = Date.now()): number {
  return now - RUN_CONFIGURATION_WINDOW_DAYS * DAY_MS;
}

/** What a plan row contributes: its identity, its scope and its targets. */
interface PlanRow {
  id: string;
  name: string;
  kind: string;
  scope: unknown;
  scenarioIds: string[];
  targets: unknown;
}

/**
 * The configurations a project's run plans already ran with.
 *
 * The run dialog's Run name dropdown reads this. It cannot read the plan rows
 * instead: a plan row holds the configuration of its LAST run only, while
 * configuration identity is wider than plan identity, so one plan run twice
 * with different parameters is two entries that both have to be offered.
 *
 * Two stores meet here and each answers what only it knows. ClickHouse holds
 * what each run was asked to do: its targets, its models, its parameters, and
 * the repeat count its batch was started with. Postgres holds what the plan
 * covers and what it is called. A run row carries no scope, so the scope of an
 * entry is the plan's current one, which is what the plan-row read already
 * offered.
 *
 * @see specs/features/agent-testing/run-configuration-history.feature
 */
export class RunConfigurationsService {
  constructor(
    private readonly repository: RunConfigurationsClickHouseRepository,
    private readonly prisma: PrismaClient,
  ) {}

  /**
   * Every configuration of the project, newest first, one entry per
   * configuration.
   *
   * The whole project rather than one scope: the dialog already filters by
   * scope key, and the scopes a plan covers live on the plan row, so cutting
   * by scope here would mean resolving every plan's scope before the query
   * instead of after it, for a list the caller filters anyway.
   *
   * An empty list is the ordinary state of a project whose plans never ran.
   */
  async getEntries({
    projectId,
    startDate,
    endDate,
    limit,
  }: {
    projectId: string;
    startDate?: number;
    endDate?: number;
    limit?: number;
  }): Promise<RunConfigurationEntry[]> {
    const plans = await this.readPlans(projectId);
    if (plans.size === 0) return [];

    const filter: ResultsFilter = {
      projectId,
      startDate: startDate ?? defaultConfigurationWindowStart(),
      ...(endDate !== undefined ? { endDate } : {}),
      scenarioSetIds: [...plans.keys()],
    };

    const rows = await this.repository.findConfigurations({
      filter,
      limit: limit ?? MAX_RUN_CONFIGURATIONS,
    });

    return collapse(
      rows.flatMap((row) => {
        const plan = plans.get(row.SetId);
        return plan ? [toEntry({ row, plan })] : [];
      }),
    );
  }

  /**
   * The plans that may own a configuration, keyed by the set id their runs
   * carry.
   *
   * Archived plans are left out, which is also what keeps their runs out of
   * the query: the set ids read here are the set filter the query runs under.
   */
  private async readPlans(projectId: string): Promise<Map<string, PlanRow>> {
    const suites = await this.prisma.simulationSuite.findMany({
      where: { projectId, archivedAt: null },
      select: {
        id: true,
        name: true,
        kind: true,
        scope: true,
        scenarioIds: true,
        targets: true,
      },
    });
    return new Map(suites.map((suite) => [getSuiteSetId(suite.id), suite]));
  }
}

/**
 * What a plan covers, with the hand-picked list inside the rule.
 *
 * A test suite is only a grouping, so its scope is itself. Every other plan
 * carries its rule, and a hand-picked one carries its stored list.
 */
function scopeOf(plan: PlanRow): RunConfigurationScope {
  if (plan.kind === "test_suite")
    return { mode: "test_suites", testSuiteIds: [plan.id] };
  const stored = parseSuiteScope(plan.scope);
  if (stored.mode === "scenarios") {
    return { mode: "scenarios", scenarioIds: [...plan.scenarioIds] };
  }
  return stored;
}

/** The scope as the key recipe takes it: the rule, without the picked list. */
function toSuiteScope(scope: RunConfigurationScope): SuiteScope {
  if (scope.mode === "scenarios") return { mode: "scenarios" };
  return scope;
}

/** The scenarios a rule names inside itself, which only a hand-picked one does. */
function scenarioIdsOf(scope: RunConfigurationScope): string[] | undefined {
  return scope.mode === "scenarios" ? scope.scenarioIds : undefined;
}

/** The targets a plan row holds, by key and by reference, dropping anything that no longer parses. */
function planTargets(raw: unknown): PlanTargets {
  const entries = Array.isArray(raw) ? raw : [];
  const byKey = new Map<string, SuiteTarget>();
  const byReference = new Map<string, SuiteTarget>();
  for (const entry of entries) {
    const parsed = suiteTargetSchema.safeParse(entry);
    if (!parsed.success) continue;
    byKey.set(targetKeyOf(parsed.data), parsed.data);
    byReference.set(parsed.data.referenceId, parsed.data);
  }
  return { byKey, byReference };
}

/** A plan row's targets, keyed both ways a recorded target is looked up. */
interface PlanTargets {
  byKey: Map<string, SuiteTarget>;
  byReference: Map<string, SuiteTarget>;
}

/**
 * A recorded `<type>:<targetKey>` pair and its overrides, as the target the
 * dialog reopens.
 *
 * The identity comes from the run: its reference id, and the overrides it
 * ran with. The plan row's target contributes only what the run row never
 * held, the prompt bindings and the secret parameter names, matched by key
 * and then by reference. Neither takes part in the configuration key, so
 * this cannot change which configurations are listed; without it a picked
 * prompt target would come back with its bindings lost.
 */
function toTarget({
  pair,
  parameters,
  planTargets,
}: {
  pair: string;
  /** The raw overrides the run recorded for this target, or ''. */
  parameters: string;
  planTargets: PlanTargets;
}): SuiteTarget | null {
  const separator = pair.indexOf(":");
  if (separator < 0) return null;
  const key = pair.slice(separator + 1);
  const { referenceId } = splitTargetKey(key);
  if (referenceId === "") return null;

  const stored =
    planTargets.byKey.get(key) ?? planTargets.byReference.get(referenceId);
  const type = stored?.type ?? pair.slice(0, separator);
  if (
    type !== "http" &&
    type !== "prompt" &&
    type !== "code" &&
    type !== "workflow"
  ) {
    return null;
  }

  const runParameters = parseRunParametersJson(parameters);
  return {
    type,
    referenceId,
    ...(stored?.scenarioMappings !== undefined && {
      scenarioMappings: stored.scenarioMappings,
    }),
    ...(stored?.runSecretParameterNames !== undefined && {
      runSecretParameterNames: stored.runSecretParameterNames,
    }),
    ...(hasParameterOverrides(runParameters) && { runParameters }),
  };
}

/**
 * The run-level values a run recorded.
 *
 * The stored parameters are the merged set the first scenario run resolved,
 * which includes the overrides of the target that run went against. Those
 * belong to the target, so they are taken back out; what is left is what was
 * set for the run as a whole.
 */
function runLevelParameters(row: RawRunConfigurationRow): RunParameterValues {
  const merged = parseRunParametersJson(row.Parameters);
  const overrides = parseRunParametersJson(row.FirstTargetParameters);
  return (
    withoutParameterNames({
      values: merged,
      names: new Set(Object.keys(overrides)),
    }) ?? {}
  );
}

/** One folded row, plus the plan that owns it, as one dropdown entry. */
function toEntry({
  row,
  plan,
}: {
  row: RawRunConfigurationRow;
  plan: PlanRow;
}): RunConfigurationEntry {
  const stored = planTargets(plan.targets);
  const targets = row.TargetPairs.flatMap((pair, index) => {
    const target = toTarget({
      pair,
      parameters: row.TargetParameters[index] ?? "",
      planTargets: stored,
    });
    return target ? [target] : [];
  });
  const scope = scopeOf(plan);
  const runParameters = runLevelParameters(row);
  const configuration = {
    scope,
    targets,
    repeatCount: Number(row.RepeatCount) || 1,
    // '' is what a plan naming no model records, and what a run recorded
    // before the models were stamped reads as. Both mean the project default.
    simulatorModel: row.SimulatorModel === "" ? null : row.SimulatorModel,
    judgeModel: row.JudgeModel === "" ? null : row.JudgeModel,
  };

  return {
    key: configurationKey({
      config: {
        scope: toSuiteScope(scope),
        targets,
        repeatCount: configuration.repeatCount,
        simulatorModel: configuration.simulatorModel,
        judgeModel: configuration.judgeModel,
      },
      scenarioIds: scenarioIdsOf(scope),
      parameters: runParameters,
    }),
    planId: plan.id,
    planName: plan.name,
    configuration,
    runParameters,
    // The fact, never the note: ClickHouse serialises the flag as "1" or "0".
    usesNote: row.UsesNote === "1",
    lastRunAt: new Date(Number(row.LastRunAtMs)),
  };
}

/**
 * One entry per key, keeping the newest, newest first.
 *
 * The database already folds most of this. It cannot fold all of it: the key
 * sorts the targets and the parameter names, and it folds in the plan's scope,
 * none of which the grouping in SQL can see. So two rows that differ only in
 * the order their parameters were written land on one entry here.
 */
function collapse(entries: RunConfigurationEntry[]): RunConfigurationEntry[] {
  const newestByKey = new Map<string, RunConfigurationEntry>();
  for (const entry of entries) {
    const seen = newestByKey.get(entry.key);
    if (!seen) {
      newestByKey.set(entry.key, entry);
      continue;
    }
    // The newest run wins every field but one. A configuration that ever took
    // a note takes one, so the flag survives a run that skipped it.
    const usesNote = seen.usesNote || entry.usesNote;
    const newest =
      entry.lastRunAt.getTime() > seen.lastRunAt.getTime() ? entry : seen;
    newestByKey.set(entry.key, { ...newest, usesNote });
  }
  return [...newestByKey.values()].sort(
    (left, right) => right.lastRunAt.getTime() - left.lastRunAt.getTime(),
  );
}

/** Exported for the tests that pin the mapping from a folded row to an entry. */
export const __testing = {
  toEntry,
  scopeOf,
  toTarget,
  collapse,
};

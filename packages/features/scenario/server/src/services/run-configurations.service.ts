import {
  parseRunParametersJson,
  withoutParameterNames,
  type ResultsFilter,
  type RunParameterValues,
} from "@langwatch/scenario-contract";
import {
  configurationKey,
  getSuiteSetId,
  hasParameterOverrides,
  parseSuiteScope,
  splitTargetKey,
  suiteTargetSchema,
  targetKeyOf,
  type SuiteScope,
  type SuiteTarget,
} from "@langwatch/suite-contract";
import {
  MAX_RUN_CONFIGURATIONS,
  type RawRunConfigurationRow,
  type RunConfigurationsReadPort,
} from "../ports/run-configurations-read.port";
import type { ScenarioPlanRecord, ScenarioRepository } from "../repositories/scenario.repository";

/** How far back a configuration is still offered, in days. */
const RUN_CONFIGURATION_WINDOW_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The default window, as a start timestamp. */
function defaultConfigurationWindowStart(now = Date.now()): number {
  return now - RUN_CONFIGURATION_WINDOW_DAYS * DAY_MS;
}

/**
 * What a configuration covers, with the hand-picked list inside the rule. The stored scope names no
 * scenarios, because a plan keeps its hand-picked list in its own `scenarioIds` column.
 */
export type RunConfigurationScope =
  | { mode: "all" }
  | { mode: "test_suites"; testSuiteIds: string[] }
  | { mode: "labels"; labels: string[] }
  | { mode: "scenarios"; scenarioIds: string[] };

/** Everything a picked entry puts back into the run dialog. */
export interface RunConfiguration {
  scope: RunConfigurationScope;
  /** Stably sorted, so "dev vs prod" and "prod vs dev" are one configuration. */
  targets: SuiteTarget[];
  repeatCount: number;
  simulatorModel: string | null;
  judgeModel: string | null;
}

/** One line of the Run name dropdown. */
export interface RunConfigurationEntry {
  /**
   * The configuration's identity, from the shared recipe in
   * `@langwatch/suite-contract`'s `plan-config.ts`. One key per configuration,
   * never per plan.
   */
  key: string;
  planId: string;
  planName: string;
  configuration: RunConfiguration;
  /** The parameter values this configuration ran with. */
  runParameters: RunParameterValues;
  /**
   * Whether a run of this configuration carried a note. A run plan that takes a note takes one
   * every run, and the text changes every run, so the fact is worth remembering and the text is
   * not.
   */
  usesNote: boolean;
  /** When the newest run of this configuration started. */
  lastRunAt: Date;
}

/**
 * The configurations a project's run plans already ran with. The run dialog's Run name dropdown
 * reads this.
 * @see specs/features/agent-testing/run-configuration-history.feature
 */
export class RunConfigurationsService {
  static create(
    repository: RunConfigurationsReadPort,
    scenarios: ScenarioRepository,
  ): RunConfigurationsService {
    return new RunConfigurationsService(repository, scenarios);
  }

  private constructor(
    private readonly repository: RunConfigurationsReadPort,
    private readonly scenarios: ScenarioRepository,
  ) {}

  /**
   * Every configuration of the project, newest first, one entry per configuration.
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
    if (plans.size === 0) {
      return [];
    }

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
   * The plans that may own a configuration, keyed by the set id their runs carry. Archived plans
   * are left out, which is also what keeps their runs out of the query: the set ids read here are
   * the set filter the query runs under.
   */
  private async readPlans(projectId: string): Promise<Map<string, ScenarioPlanRecord>> {
    const plans = await this.scenarios.findPlans({ projectId });

    return new Map(plans.map((plan) => [getSuiteSetId(plan.id), plan]));
  }
}

/**
 * What a plan covers, with the hand-picked list inside the rule. A test suite is only a grouping,
 * so its scope is itself. Every other plan carries its rule, and a hand-picked one carries its
 * stored list.
 */
function scopeOf(plan: ScenarioPlanRecord): RunConfigurationScope {
  if (plan.kind === "test_suite") {
    return { mode: "test_suites", testSuiteIds: [plan.id] };
  }

  const stored = parseSuiteScope(plan.scope);
  if (stored.mode === "scenarios") {
    return { mode: "scenarios", scenarioIds: [...plan.scenarioIds] };
  }

  return stored;
}

/** The scope as the key recipe takes it: the rule, without the picked list. */
function toSuiteScope(scope: RunConfigurationScope): SuiteScope {
  if (scope.mode === "scenarios") {
    return { mode: "scenarios" };
  }

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
    if (!parsed.success) {
      continue;
    }

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
 * A recorded `<type>:<targetKey>` pair and its overrides, as the target the dialog reopens. The
 * identity comes from the run: its reference id, and the overrides it ran with.
 */
function toTarget({
  pair,
  parameters,
  storedTargets,
}: {
  pair: string;
  /** The raw overrides the run recorded for this target, or ''. */
  parameters: string;
  storedTargets: PlanTargets;
}): SuiteTarget | null {
  const separator = pair.indexOf(":");
  if (separator < 0) {
    return null;
  }

  const key = pair.slice(separator + 1);
  const { referenceId } = splitTargetKey(key);
  if (referenceId === "") {
    return null;
  }

  const stored = storedTargets.byKey.get(key) ?? storedTargets.byReference.get(referenceId);
  const type = stored?.type ?? pair.slice(0, separator);
  if (type !== "http" && type !== "prompt" && type !== "code" && type !== "workflow") {
    return null;
  }

  const runParameters = parseRunParametersJson(parameters);

  return {
    type,
    referenceId,
    ...(stored?.scenarioMappings !== undefined && { scenarioMappings: stored.scenarioMappings }),
    ...(stored?.runSecretParameterNames !== undefined && {
      runSecretParameterNames: stored.runSecretParameterNames,
    }),
    ...(hasParameterOverrides(runParameters) && { runParameters }),
  };
}

/**
 * The run-level values a run recorded. The stored parameters are the merged set the first scenario
 * run resolved, which includes the overrides of the target that run went against. Those belong to
 * the target, so they are taken back out; what is left is what was set for the run as a whole.
 */
function runLevelParameters(row: RawRunConfigurationRow): RunParameterValues {
  const merged = parseRunParametersJson(row.Parameters);
  const overrides = parseRunParametersJson(row.FirstTargetParameters);

  return withoutParameterNames({ values: merged, names: new Set(Object.keys(overrides)) }) ?? {};
}

/** One folded row, plus the plan that owns it, as one dropdown entry. */
function toEntry({
  row,
  plan,
}: {
  row: RawRunConfigurationRow;
  plan: ScenarioPlanRecord;
}): RunConfigurationEntry {
  const stored = planTargets(plan.targets);
  const targets = row.TargetPairs.flatMap((pair, index) => {
    const target = toTarget({
      pair,
      parameters: row.TargetParameters[index] ?? "",
      storedTargets: stored,
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
 * One entry per key, keeping the newest, newest first. The database already folds most of this. It
 * cannot fold all of it: the key sorts the targets and the parameter names, and it folds in the
 * plan's scope, none of which the grouping in SQL can see.
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
    const newest = entry.lastRunAt.getTime() > seen.lastRunAt.getTime() ? entry : seen;
    newestByKey.set(entry.key, { ...newest, usesNote });
  }

  return [...newestByKey.values()].sort(
    (left, right) => right.lastRunAt.getTime() - left.lastRunAt.getTime(),
  );
}

/** Exported for the tests that pin the mapping from a folded row to an entry. */
export const __testing = { toEntry, scopeOf, toTarget, collapse };

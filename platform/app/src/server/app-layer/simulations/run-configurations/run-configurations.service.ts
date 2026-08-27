import type { PrismaClient } from "~/generated/prisma/client";
import type { RunParameterValues } from "~/server/scenarios/parameters";
import { configurationKey } from "~/server/suites/plan-config";
import { parseSuiteScope, type SuiteScope } from "~/server/suites/scope";
import { getSuiteSetId } from "~/server/suites/suite-set-id";
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
 * A folder is only a grouping, so its scope is itself. Every other plan
 * carries its rule, and a hand-picked one carries its stored list.
 */
function scopeOf(plan: PlanRow): RunConfigurationScope {
  if (plan.kind === "folder") return { mode: "folders", folderIds: [plan.id] };
  const stored = parseSuiteScope(plan.scope);
  if (stored.mode === "cases") {
    return { mode: "cases", caseIds: [...plan.scenarioIds] };
  }
  return stored;
}

/** The scope as the key recipe takes it: the rule, without the picked list. */
function toSuiteScope(scope: RunConfigurationScope): SuiteScope {
  if (scope.mode === "cases") return { mode: "cases" };
  return scope;
}

/** The scenarios a rule names inside itself, which only a hand-picked one does. */
function caseIdsOf(scope: RunConfigurationScope): string[] | undefined {
  return scope.mode === "cases" ? scope.caseIds : undefined;
}

/** The targets a plan row holds, dropping anything that no longer parses. */
function planTargets(raw: unknown): Map<string, SuiteTarget> {
  const entries = Array.isArray(raw) ? raw : [];
  const byReference = new Map<string, SuiteTarget>();
  for (const entry of entries) {
    const parsed = suiteTargetSchema.safeParse(entry);
    if (parsed.success) byReference.set(parsed.data.referenceId, parsed.data);
  }
  return byReference;
}

/**
 * A recorded `<type>:<referenceId>` pair, as the target the dialog reopens.
 *
 * The plan row's target wins when it names the same reference, because it
 * carries the prompt bindings and the secret parameter names the run row never
 * held. Neither takes part in the configuration key, so this cannot change
 * which configurations are listed; without it a picked prompt target would
 * come back with its bindings lost.
 */
function toTarget({
  pair,
  planTargetsByReference,
}: {
  pair: string;
  planTargetsByReference: Map<string, SuiteTarget>;
}): SuiteTarget | null {
  const separator = pair.indexOf(":");
  if (separator < 0) return null;
  const referenceId = pair.slice(separator + 1);
  if (referenceId === "") return null;

  const stored = planTargetsByReference.get(referenceId);
  if (stored) return stored;

  const type = pair.slice(0, separator);
  if (
    type !== "http" &&
    type !== "prompt" &&
    type !== "code" &&
    type !== "workflow"
  ) {
    return null;
  }
  return { type, referenceId };
}

/**
 * The parameter values a run recorded, read back off the raw stored JSON.
 *
 * Tolerant on purpose: a value the current shape does not understand is
 * dropped rather than taking the whole entry down, the same way a stored scope
 * that no longer parses still runs. A run with no parameters stored the empty
 * string.
 */
function parseRunParameters(raw: string): RunParameterValues {
  if (raw === "") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {};
  }

  const values: RunParameterValues = {};
  for (const [name, value] of Object.entries(parsed)) {
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      values[name] = value;
    }
  }
  return values;
}

/** One folded row, plus the plan that owns it, as one dropdown entry. */
function toEntry({
  row,
  plan,
}: {
  row: RawRunConfigurationRow;
  plan: PlanRow;
}): RunConfigurationEntry {
  const planTargetsByReference = planTargets(plan.targets);
  const targets = row.TargetPairs.flatMap((pair) => {
    const target = toTarget({ pair, planTargetsByReference });
    return target ? [target] : [];
  });
  const scope = scopeOf(plan);
  const runParameters = parseRunParameters(row.Parameters);
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
      scenarioIds: caseIdsOf(scope),
      parameters: runParameters,
    }),
    planId: plan.id,
    planName: plan.name,
    configuration,
    runParameters,
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
    if (!seen || entry.lastRunAt.getTime() > seen.lastRunAt.getTime()) {
      newestByKey.set(entry.key, entry);
    }
  }
  return [...newestByKey.values()].sort(
    (left, right) => right.lastRunAt.getTime() - left.lastRunAt.getTime(),
  );
}

/** Exported for the tests that pin the mapping from a folded row to an entry. */
export const __testing = {
  toEntry,
  scopeOf,
  parseRunParameters,
  toTarget,
  collapse,
};

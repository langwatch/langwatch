/**
 * A `scope: "organization"` widget query, run once per project the member can see and merged:
 * each row names its project; a failed or empty project is one row saying so. Per project
 * because the server checks each project's permissions; a server-side org query is the scale path.
 */

import type {
  ChartQueryError,
  ChartQueryResult,
} from "@langwatch/analytics-contract/chart-frame-protocol";

/** A project the member can see in the organization. */
export interface FanOutProject {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
}

/** The part of `organization.getScopeGraph` a fan-out reads: each organization's projects. */
export type ScopeGraphOrganization = {
  id: string;
  teams: { projects: { id: string; slug: string; name: string }[] }[];
};

/** Every project of the organization, once each, sorted by name. */
export function projectsOfOrganization({
  graph,
  organizationId,
}: {
  graph: readonly ScopeGraphOrganization[];
  organizationId: string | undefined;
}): FanOutProject[] {
  const organization = graph.find(({ id }) => id === organizationId);
  const byId = new Map<string, FanOutProject>();
  for (const team of organization?.teams ?? []) {
    for (const { id, slug, name } of team.projects) byId.set(id, { id, slug, name });
  }
  return [...byId.values()].toSorted((a, b) => a.name.localeCompare(b.name));
}

export type ProjectRun =
  | { readonly project: FanOutProject; readonly ok: true; readonly result: ChartQueryResult }
  | { readonly project: FanOutProject; readonly ok: false; readonly error: ChartQueryError };

/** The columns every merged row carries, ahead of the query's own. */
export const PROJECT_COLUMNS = [
  { name: "project_id", type: "String" },
  { name: "project_slug", type: "String" },
  { name: "project_name", type: "String" },
  { name: "project_error", type: "Nullable(String)" },
  { name: "project_error_code", type: "Nullable(String)" },
  { name: "project_empty", type: "Bool" },
] as const;

/** How many project queries run at once, across every widget on the board. */
export const FAN_OUT_CONCURRENCY = 6;

const tagOf = (project: FanOutProject) => ({
  project_id: project.id,
  project_slug: project.slug,
  project_name: project.name,
});

function sumStatistic(results: readonly ChartQueryResult[], key: string): number {
  return results.reduce((total, result) => {
    const value = result.statistics[key];
    return total + (typeof value === "number" ? value : 0);
  }, 0);
}

/**
 * One result from every project's run; when all failed, the first failure is thrown. Completeness
 * is left out: it describes one project's rows, so merged widgets count gaps in their own columns.
 */
export function mergeProjectRuns(runs: readonly ProjectRun[]): ChartQueryResult {
  const successes = runs.flatMap((run) => (run.ok ? [run.result] : []));
  const firstFailure = runs.find((run) => !run.ok);
  if (successes.length === 0 && firstFailure && !firstFailure.ok) throw firstFailure.error;

  const columns = new Map<string, { name: string; type: string }>(
    PROJECT_COLUMNS.map((column) => [column.name, column]),
  );
  for (const result of successes) {
    for (const column of result.columns) {
      if (!columns.has(column.name)) columns.set(column.name, column);
    }
  }
  const rows = runs.flatMap((run): Record<string, unknown>[] => {
    const clean = { ...tagOf(run.project), project_error: null, project_error_code: null };
    if (!run.ok) {
      return [
        {
          ...tagOf(run.project),
          project_error: run.error.message || run.error.title,
          project_error_code: run.error.code,
          project_empty: true,
        },
      ];
    }
    // A project that answered with nothing is still listed, so a widget can show it as quiet.
    if (run.result.rows.length === 0) return [{ ...clean, project_empty: true }];
    return run.result.rows.map((row) => ({ ...row, ...clean, project_empty: false }));
  });
  const first = successes[0];
  return {
    columns: [...columns.values()],
    rows,
    statistics: {
      elapsedMs: Math.max(0, ...successes.map((result) => Number(result.statistics.elapsedMs) || 0)),
      rowsRead: sumStatistic(successes, "rowsRead"),
      bytesRead: sumStatistic(successes, "bytesRead"),
      rowsReturned: rows.length,
    },
    diagnostics: successes.flatMap((result) => result.diagnostics),
    followsTimeWindow: successes.every((result) => result.followsTimeWindow),
    followsGranularity: successes.every((result) => result.followsGranularity),
    ...(first?.granularitySeconds !== undefined
      ? { granularitySeconds: first.granularitySeconds }
      : {}),
  };
}

/** Runs at most `limit` tasks at a time; the rest wait their turn in order. */
export function createConcurrencyLimit(limit: number) {
  let running = 0;
  const waiting: (() => void)[] = [];
  const release = () => {
    running -= 1;
    waiting.shift()?.();
  };
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (running >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    running += 1;
    try {
      return await task();
    } finally {
      release();
    }
  };
}

/** How long a settled run answers the same question again: widgets on one board load at once. */
export const FAN_OUT_REUSE_MS = 20_000;

/**
 * One run per key: widgets asking a project the same question share it, in flight and for
 * `reuseMs` after it settles. A failure is never reused, so a retry always asks again.
 */
export function createRunShare({ reuseMs, now }: { reuseMs: number; now: () => number }) {
  const runs = new Map<string, { started: number; result: Promise<ChartQueryResult> }>();
  return (key: string, run: () => Promise<ChartQueryResult>): Promise<ChartQueryResult> => {
    for (const [stale, entry] of runs) {
      if (now() - entry.started >= reuseMs) runs.delete(stale);
    }
    const existing = runs.get(key);
    if (existing) return existing.result;
    const result = run();
    runs.set(key, { started: now(), result });
    result.catch(() => runs.delete(key));
    return result;
  };
}

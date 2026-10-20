/** Pure helpers for driving run plans and reading their batch: no I/O, so they are tested. */

export interface RunRow {
  status?: string;
  name?: string;
  scenarioId?: string;
  results?: { reasoning?: string } | null;
}

const FINAL = new Set(["SUCCESS", "FAILED", "ERROR", "CANCELLED", "PASSED", "FAILURE"]);
const PASSED = new Set(["SUCCESS", "PASSED"]);
const E2E_NAME = /^E2E \w+ (\d+):/;

/** The list inside a response that is a bare array or wraps it under `data`, `runs` or `items`. */
export function unwrapList<T>({ body }: { body: unknown }): T[] {
  if (Array.isArray(body)) return body as T[];
  const wrapped = body as Record<string, unknown> | null;
  for (const key of ["data", "runs", "scenarios", "items"]) {
    if (Array.isArray(wrapped?.[key])) return wrapped[key] as T[];
  }
  throw new Error(`expected a list, got ${JSON.stringify(body).slice(0, 300)}`);
}

/** True once there is at least one run and every run has a final status. */
export function isBatchDone({ runs }: { runs: RunRow[] }): boolean {
  return runs.length > 0 && runs.every((run) => FINAL.has((run.status ?? "").toUpperCase()));
}

/** `STATUS | name | first 200 characters of the reasoning`, on one line. */
export function formatRun({ run }: { run: RunRow }): string {
  const reasoning = (run.results?.reasoning ?? "").slice(0, 200).replace(/\s+/g, " ");
  return `${run.status ?? "?"} | ${run.name ?? run.scenarioId ?? "?"} | ${reasoning}`;
}

/** `overall: N/M passed` */
export function summaryLine({ runs }: { runs: RunRow[] }): string {
  const passed = runs.filter((run) => PASSED.has((run.status ?? "").toUpperCase())).length;
  return `overall: ${passed}/${runs.length} passed`;
}

/** Ids of the scenarios named `E2E <group> <number>: ...` whose number is wanted. */
export function matchScenarioIds({
  scenarios,
  numbers,
}: {
  scenarios: { id: string; name: string }[];
  numbers: string[];
}): string[] {
  const wanted = new Set(numbers);
  return scenarios.filter((s) => wanted.has(E2E_NAME.exec(s.name)?.[1] ?? "")).map((s) => s.id);
}

/** Plans by exact name; throws naming the first one the project does not have. */
export function resolvePlanIds({
  plans,
  names,
}: {
  plans: { id: string; name: string }[];
  names: string[];
}): { name: string; id: string }[] {
  return names.map((name) => {
    const plan = plans.find((p) => p.name === name);
    if (!plan) throw new Error(`no run plan named "${name}"`);
    return { name, id: plan.id };
  });
}

/** The body of POST /api/v1/run-plans/run for the retry plan. */
export function retryPlanBody({
  scenarioIds,
  agentId,
}: {
  scenarioIds: string[];
  agentId: string;
}) {
  return {
    name: "Langy e2e retry",
    config: {
      scope: { mode: "scenarios" },
      scenarioIds,
      targets: [{ type: "connected", referenceId: agentId }],
      repeatCount: 1,
    },
  };
}

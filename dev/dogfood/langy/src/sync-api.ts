/**
 * The public routes the sync reads and writes. Run plans go through the deprecated
 * `/api/suites` family: `/api/v1/run-plans` cannot create or edit a plan (README gap 20).
 */
import { expectOk, type LangWatchHttp } from "./http.ts";
import {
  SCENARIO_FIELDS,
  type DesiredRunPlan,
  type RemoteRunPlan,
  type RemoteScenario,
  type ScenarioSpec,
} from "./sync-diff.ts";

interface ScenarioWire extends Partial<Omit<RemoteScenario, "id" | "name">> {
  id: string;
  name: string;
}

interface AgentWire {
  id: string;
  name: string;
  type: string;
}

interface AgentPage {
  data: AgentWire[];
  pagination: { page: number; totalPages: number };
}

interface SuiteWire {
  id: string;
  name: string;
  kind?: string;
  description: string | null;
  scope?: { mode: string } | null;
  scenarioIds: string[];
  targets: { type: string; referenceId: string }[];
  repeatCount: number;
}

/** The project's scenarios, with the fields a sync owns and the server's defaults filled in. */
export async function listScenarios({ http }: { http: LangWatchHttp }): Promise<RemoteScenario[]> {
  const answer = await http.request<ScenarioWire[]>({ method: "GET", path: "/api/v1/scenarios" });
  return expectOk({ answer, what: "list scenarios" }).map((wire) => ({
    id: wire.id,
    name: wire.name,
    situation: wire.situation ?? "",
    criteria: wire.criteria ?? [],
    labels: wire.labels ?? [],
    parameters: wire.parameters ?? [],
    maxTurns: wire.maxTurns ?? null,
    minTurns: wire.minTurns ?? null,
    simulatorModel: wire.simulatorModel ?? null,
    judgeModel: wire.judgeModel ?? null,
  }));
}

function scenarioBody({ spec }: { spec: ScenarioSpec }): Record<string, unknown> {
  return Object.fromEntries(SCENARIO_FIELDS.map((field) => [field, spec[field]]));
}

/** Creates the scenario in the project's Default test suite and gives its id. */
export async function createScenario({
  http,
  spec,
}: {
  http: LangWatchHttp;
  spec: ScenarioSpec;
}): Promise<string> {
  const answer = await http.request<{ id: string }>({
    method: "POST",
    path: "/api/v1/scenarios",
    body: { name: spec.name, ...scenarioBody({ spec }) },
  });
  return expectOk({ answer, what: `create scenario "${spec.name}"` }).id;
}

/** Writes every owned field, so the scenario ends exactly as the file states it. */
export async function updateScenario({
  http,
  id,
  spec,
}: {
  http: LangWatchHttp;
  id: string;
  spec: ScenarioSpec;
}): Promise<void> {
  const answer = await http.request({
    method: "PUT",
    path: `/api/v1/scenarios/${encodeURIComponent(id)}`,
    body: scenarioBody({ spec }),
  });
  expectOk({ answer, what: `update scenario "${spec.name}"` });
}

/** The id of the one connected agent with this name; none or several stops the sync. */
export async function findConnectedAgentId({
  http,
  name,
}: {
  http: LangWatchHttp;
  name: string;
}): Promise<string> {
  const agents: AgentWire[] = [];
  for (let page = 1, totalPages = 1; page <= totalPages; page++) {
    const answer = await http.request<AgentPage>({
      method: "GET",
      path: `/api/v1/agents?page=${page}&limit=100`,
    });
    const body = expectOk({ answer, what: "list agents" });
    agents.push(...body.data);
    totalPages = body.pagination.totalPages;
  }
  const matches = agents.filter((agent) => agent.name === name && agent.type === "connected");
  if (matches.length !== 1) {
    throw new Error(`Expected one connected agent named "${name}", found ${matches.length}`);
  }
  return matches[0]!.id;
}

/** The project's run plans (not its test suites). */
export async function listRunPlans({ http }: { http: LangWatchHttp }): Promise<RemoteRunPlan[]> {
  const answer = await http.request<SuiteWire[]>({
    method: "GET",
    path: "/api/suites?kind=custom",
  });
  return expectOk({ answer, what: "list run plans" }).map((wire) => ({
    id: wire.id,
    name: wire.name,
    description: wire.description,
    scopeMode: wire.scope?.mode ?? null,
    scenarioIds: wire.scenarioIds,
    targets: wire.targets.map(({ type, referenceId }) => ({ type, referenceId })),
    repeatCount: wire.repeatCount,
  }));
}

function runPlanBody({ desired }: { desired: DesiredRunPlan }): Record<string, unknown> {
  return {
    description: desired.description,
    scope: { mode: "cases" },
    scenarioIds: desired.scenarioIds,
    targets: desired.targets,
    repeatCount: desired.repeatCount,
  };
}

export async function createRunPlan({
  http,
  desired,
}: {
  http: LangWatchHttp;
  desired: DesiredRunPlan;
}): Promise<string> {
  const body = runPlanBody({ desired });
  const answer = await http.request<{ id: string }>({
    method: "POST",
    path: "/api/suites",
    body: {
      name: desired.name,
      kind: "custom",
      ...body,
      // The create route takes no null description; absent means none.
      description: desired.description ?? undefined,
    },
  });
  return expectOk({ answer, what: `create run plan "${desired.name}"` }).id;
}

export async function updateRunPlan({
  http,
  id,
  desired,
}: {
  http: LangWatchHttp;
  id: string;
  desired: DesiredRunPlan;
}): Promise<void> {
  const answer = await http.request({
    method: "PATCH",
    path: `/api/suites/${encodeURIComponent(id)}`,
    body: runPlanBody({ desired }),
  });
  expectOk({ answer, what: `update run plan "${desired.name}"` });
}

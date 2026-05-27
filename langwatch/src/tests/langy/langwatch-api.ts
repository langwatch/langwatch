// Direct LangWatch HTTP helpers for Layer 2 (side-effect) verification.
// These bypass Langy/MCP and hit the LangWatch app at LW_BASE_URL with the
// project API key, so a passing call here proves the entity actually
// landed in the backend regardless of what Langy claimed.

const LW_BASE = process.env.LW_BASE_URL ?? "http://localhost:5560";
const LW_KEY = process.env.LANGWATCH_API_KEY ?? "";

// Generic so each caller can declare the response shape it expects; bodies
// fall back to `{ data?: unknown }` because every endpoint here wraps the
// payload in `{ data: [...] }` (or returns the array directly).
async function lwGet<T = { data?: unknown }>(path: string): Promise<T> {
  const res = await fetch(`${LW_BASE}${path}`, {
    headers: { "X-Auth-Token": LW_KEY },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`GET ${path} -> ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

// Every endpoint returns either { data: T[] } or the array directly.
// This wrapper picks whichever shape came back, returning [] if neither.
async function lwGetList<T>(path: string): Promise<T[]> {
  const j = await lwGet<{ data?: T[] } | T[]>(path);
  if (Array.isArray(j)) return j;
  return j.data ?? [];
}

export async function listDatasets() {
  return lwGetList<{ id: string; name: string; recordCount: number }>(
    "/api/dataset",
  );
}

export async function listAgents() {
  return lwGetList<{ id: string; name: string }>("/api/agents");
}

export async function listEvaluators() {
  return lwGetList<{ id: string; name: string }>("/api/evaluators");
}

export async function listScenarios() {
  return lwGetList<{ id: string; name: string }>("/api/scenarios");
}

export async function listPrompts() {
  return lwGetList<{ id: string; name?: string; handle?: string }>(
    "/api/prompts",
  );
}

export async function listMonitors() {
  return lwGetList<{ id: string; name?: string }>("/api/monitors");
}

export async function listDashboards() {
  return lwGetList<{ id: string; name?: string }>("/api/dashboards");
}

export async function listWorkflows() {
  return lwGetList<{ id: string; name?: string }>("/api/workflows");
}

export async function listAnnotations() {
  return lwGetList<{ id: string }>("/api/annotations");
}

export async function listTriggers() {
  return lwGetList<{ id: string; name?: string }>("/api/triggers");
}

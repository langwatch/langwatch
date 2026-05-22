// Direct LangWatch HTTP helpers for Layer 2 (side-effect) verification.
// These bypass Langy/MCP and hit the LangWatch app at LW_BASE_URL with the
// project API key, so a passing call here proves the entity actually
// landed in the backend regardless of what Langy claimed.

const LW_BASE = process.env.LW_BASE_URL ?? "http://localhost:5560";
const LW_KEY = process.env.LANGWATCH_API_KEY ?? "";

async function lwGet(path: string): Promise<any> {
  const res = await fetch(`${LW_BASE}${path}`, {
    headers: { "X-Auth-Token": LW_KEY },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`GET ${path} -> ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.json();
}

export async function listDatasets(): Promise<Array<{ id: string; name: string; recordCount: number }>> {
  const j = await lwGet("/api/dataset");
  return j.data ?? [];
}

export async function listAgents(): Promise<Array<{ id: string; name: string }>> {
  const j = await lwGet("/api/agents");
  return j.data ?? j ?? [];
}

export async function listEvaluators(): Promise<Array<{ id: string; name: string }>> {
  const j = await lwGet("/api/evaluators");
  return j.data ?? j ?? [];
}

export async function listScenarios(): Promise<Array<{ id: string; name: string }>> {
  const j = await lwGet("/api/scenarios");
  return j.data ?? j ?? [];
}

export async function listPrompts(): Promise<Array<{ id: string; name?: string; handle?: string }>> {
  const j = await lwGet("/api/prompts");
  return j.data ?? j ?? [];
}

export async function listMonitors(): Promise<Array<{ id: string; name?: string }>> {
  const j = await lwGet("/api/monitors");
  return j.data ?? j ?? [];
}

export async function listDashboards(): Promise<Array<{ id: string; name?: string }>> {
  const j = await lwGet("/api/dashboards");
  return j.data ?? j ?? [];
}

export async function listWorkflows(): Promise<Array<{ id: string; name?: string }>> {
  const j = await lwGet("/api/workflows");
  return j.data ?? j ?? [];
}

export async function listAnnotations(): Promise<Array<{ id: string }>> {
  const j = await lwGet("/api/annotations");
  return j.data ?? j ?? [];
}

export async function listTriggers(): Promise<Array<{ id: string; name?: string }>> {
  const j = await lwGet("/api/triggers");
  return j.data ?? j ?? [];
}

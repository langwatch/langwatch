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

// Normalize the various list payload shapes ({ data: [...] }, a bare array, or
// neither) to an array, so downstream .map/.filter never throws on an object.
function toArray<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (
    payload &&
    typeof payload === "object" &&
    "data" in payload &&
    Array.isArray((payload as { data?: unknown }).data)
  ) {
    return (payload as { data: T[] }).data;
  }
  return [];
}

export async function listDatasets(): Promise<Array<{ id: string; name: string; recordCount: number }>> {
  return toArray(await lwGet("/api/dataset"));
}

export async function listAgents(): Promise<Array<{ id: string; name: string }>> {
  return toArray(await lwGet("/api/agents"));
}

export async function listEvaluators(): Promise<Array<{ id: string; name: string }>> {
  return toArray(await lwGet("/api/evaluators"));
}

export async function listScenarios(): Promise<Array<{ id: string; name: string }>> {
  return toArray(await lwGet("/api/scenarios"));
}

export async function listPrompts(): Promise<Array<{ id: string; name?: string; handle?: string }>> {
  return toArray(await lwGet("/api/prompts"));
}

export async function listMonitors(): Promise<Array<{ id: string; name?: string }>> {
  return toArray(await lwGet("/api/monitors"));
}

export async function listDashboards(): Promise<Array<{ id: string; name?: string }>> {
  return toArray(await lwGet("/api/dashboards"));
}

export async function listWorkflows(): Promise<Array<{ id: string; name?: string }>> {
  return toArray(await lwGet("/api/workflows"));
}

export async function listAnnotations(): Promise<Array<{ id: string }>> {
  return toArray(await lwGet("/api/annotations"));
}

export async function listTriggers(): Promise<Array<{ id: string; name?: string }>> {
  return toArray(await lwGet("/api/triggers"));
}

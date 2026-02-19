import { makeRequest } from "./langwatch-api.js";

// --- Scenario types ---

export interface ScenarioSummary {
  id: string;
  name: string;
  situation: string;
  criteria: string[];
  labels: string[];
}

export interface ScenarioArchiveResponse {
  id: string;
  archived: boolean;
}

// --- Scenario API functions ---

/** Lists all scenarios in the project. */
export async function listScenarios(): Promise<ScenarioSummary[]> {
  return makeRequest("GET", "/api/scenarios") as Promise<ScenarioSummary[]>;
}

/** Retrieves a single scenario by ID. */
export async function getScenario(id: string): Promise<ScenarioSummary> {
  return makeRequest(
    "GET",
    `/api/scenarios/${encodeURIComponent(id)}`
  ) as Promise<ScenarioSummary>;
}

/** Creates a new scenario. */
export async function createScenario(data: {
  name: string;
  situation?: string;
  criteria?: string[];
  labels?: string[];
}): Promise<ScenarioSummary> {
  return makeRequest("POST", "/api/scenarios", data) as Promise<ScenarioSummary>;
}

/** Updates an existing scenario. */
export async function updateScenario(params: {
  id: string;
  name?: string;
  situation?: string;
  criteria?: string[];
  labels?: string[];
}): Promise<ScenarioSummary> {
  const { id, ...data } = params;
  return makeRequest(
    "PUT",
    `/api/scenarios/${encodeURIComponent(id)}`,
    data
  ) as Promise<ScenarioSummary>;
}

/** Archives (soft-deletes) a scenario. */
export async function archiveScenario(
  id: string
): Promise<ScenarioArchiveResponse> {
  return makeRequest(
    "DELETE",
    `/api/scenarios/${encodeURIComponent(id)}`
  ) as Promise<ScenarioArchiveResponse>;
}

import { makeRequest } from "./langwatch-api.js";

export interface SimulationRunSummary {
  scenarioRunId: string;
  scenarioId: string;
  batchRunId: string;
  name: string | null;
  status: string;
  durationInMs: number;
  totalCost?: number;
  results?: {
    verdict?: string | null;
    reasoning?: string | null;
    metCriteria?: string[];
    unmetCriteria?: string[];
    error?: string | null;
  } | null;
  messages?: Array<{ role: string; content: string }>;
  timestamp: number;
  updatedAt: number;
}

export interface SimulationRunListResponse {
  runs: SimulationRunSummary[];
  hasMore?: boolean;
  nextCursor?: string;
}

/** Lists simulation runs, optionally filtered by scenario set or batch. */
export async function listSimulationRuns(params?: {
  scenarioSetId?: string;
  batchRunId?: string;
  limit?: number;
}): Promise<SimulationRunListResponse> {
  const query = new URLSearchParams();
  if (params?.scenarioSetId) query.set("scenarioSetId", params.scenarioSetId);
  if (params?.batchRunId) query.set("batchRunId", params.batchRunId);
  if (params?.limit) query.set("limit", String(params.limit));
  const qs = query.toString() ? `?${query}` : "";
  return makeRequest("GET", `/api/simulation-runs${qs}`) as Promise<SimulationRunListResponse>;
}

/** Gets a single simulation run by its ID. */
export async function getSimulationRun(
  scenarioRunId: string,
): Promise<SimulationRunSummary> {
  return makeRequest(
    "GET",
    `/api/simulation-runs/${encodeURIComponent(scenarioRunId)}`,
  ) as Promise<SimulationRunSummary>;
}

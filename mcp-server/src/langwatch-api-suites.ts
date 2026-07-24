import { makeRequest } from "./langwatch-api.js";

// --- Suite types ---

export interface SuiteTarget {
  type: "prompt" | "http" | "code" | "workflow";
  referenceId: string;
}

export interface SuiteSummary {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  scenarioIds: string[];
  targets: SuiteTarget[];
  repeatCount: number;
  labels: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SuiteRunResult {
  scheduled: boolean;
  batchRunId: string;
  setId: string;
  jobCount: number;
  skippedArchived: {
    scenarios: string[];
    targets: string[];
  };
  items: Array<{
    scenarioRunId: string;
    scenarioId: string;
    target: SuiteTarget;
    name: string | null;
  }>;
}

export interface SuiteArchiveResponse {
  id: string;
  archived: boolean;
}

// --- Suite API functions ---

/** Lists all suites (run plans) in the project. */
export async function listSuites(): Promise<SuiteSummary[]> {
  return makeRequest("GET", "/api/suites") as Promise<SuiteSummary[]>;
}

/** Retrieves a single suite by ID. */
export async function getSuite(id: string): Promise<SuiteSummary> {
  return makeRequest(
    "GET",
    `/api/suites/${encodeURIComponent(id)}`
  ) as Promise<SuiteSummary>;
}

/** Creates a new suite. */
export async function createSuite(data: {
  name: string;
  description?: string;
  scenarioIds: string[];
  targets: SuiteTarget[];
  repeatCount?: number;
  labels?: string[];
}): Promise<SuiteSummary> {
  return makeRequest("POST", "/api/suites", data) as Promise<SuiteSummary>;
}

/** Updates an existing suite. */
export async function updateSuite(params: {
  id: string;
  name?: string;
  description?: string | null;
  scenarioIds?: string[];
  targets?: SuiteTarget[];
  repeatCount?: number;
  labels?: string[];
}): Promise<SuiteSummary> {
  const { id, ...data } = params;
  return makeRequest(
    "PATCH",
    `/api/suites/${encodeURIComponent(id)}`,
    data
  ) as Promise<SuiteSummary>;
}

/** Duplicates a suite. */
export async function duplicateSuite(id: string): Promise<SuiteSummary> {
  return makeRequest(
    "POST",
    `/api/suites/${encodeURIComponent(id)}/duplicate`
  ) as Promise<SuiteSummary>;
}

/** Triggers a suite run. */
export async function runSuite(
  id: string,
  idempotencyKey?: string
): Promise<SuiteRunResult> {
  return makeRequest(
    "POST",
    `/api/suites/${encodeURIComponent(id)}/run`,
    { idempotencyKey: idempotencyKey ?? `mcp-${Date.now()}-${Math.random().toString(36).slice(2)}` }
  ) as Promise<SuiteRunResult>;
}

/** Archives (soft-deletes) a suite. */
export async function archiveSuite(
  id: string
): Promise<SuiteArchiveResponse> {
  return makeRequest(
    "DELETE",
    `/api/suites/${encodeURIComponent(id)}`
  ) as Promise<SuiteArchiveResponse>;
}

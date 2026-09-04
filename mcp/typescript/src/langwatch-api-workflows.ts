import { makeRequest } from "./langwatch-api.js";

export interface WorkflowSummary {
  id: string;
  name: string;
  icon: string | null;
  description: string | null;
  isEvaluator: boolean;
  isComponent: boolean;
  createdAt: string;
  updatedAt: string;
}

export async function listWorkflows(): Promise<WorkflowSummary[]> {
  return makeRequest("GET", "/api/v1/workflows") as Promise<WorkflowSummary[]>;
}

export async function getWorkflow(id: string): Promise<WorkflowSummary> {
  return makeRequest(
    "GET",
    `/api/v1/workflows/${encodeURIComponent(id)}`,
  ) as Promise<WorkflowSummary>;
}

export async function runWorkflow(
  id: string,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return makeRequest(
    "POST",
    `/api/v1/workflows/${encodeURIComponent(id)}/run`,
    input ?? {},
  ) as Promise<Record<string, unknown>>;
}

export async function deleteWorkflow(id: string): Promise<{ id: string; archived: boolean }> {
  return makeRequest("DELETE", `/api/v1/workflows/${encodeURIComponent(id)}`) as Promise<{
    id: string;
    archived: boolean;
  }>;
}

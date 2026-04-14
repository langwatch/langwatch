import { makeRequest } from "./langwatch-api.js";

export interface MonitorSummary {
  id: string;
  name: string;
  slug: string;
  checkType: string;
  enabled: boolean;
  executionMode: string;
  sample: number;
  level: string;
  evaluatorId: string | null;
  preconditions: unknown;
  parameters: unknown;
  mappings: unknown;
  threadIdleTimeout: number | null;
  createdAt: string;
  updatedAt: string;
}

export async function listMonitors(): Promise<MonitorSummary[]> {
  return makeRequest("GET", "/api/monitors") as Promise<MonitorSummary[]>;
}

export async function getMonitor(id: string): Promise<MonitorSummary> {
  return makeRequest(
    "GET",
    `/api/monitors/${encodeURIComponent(id)}`
  ) as Promise<MonitorSummary>;
}

export async function createMonitor(data: {
  name: string;
  checkType: string;
  executionMode?: string;
  sample?: number;
  evaluatorId?: string;
  level?: string;
  parameters?: Record<string, unknown>;
}): Promise<MonitorSummary> {
  return makeRequest("POST", "/api/monitors", {
    ...data,
    preconditions: [],
    parameters: data.parameters ?? {},
  }) as Promise<MonitorSummary>;
}

export async function updateMonitor(params: {
  id: string;
  name?: string;
  enabled?: boolean;
  executionMode?: string;
  sample?: number;
  parameters?: Record<string, unknown>;
}): Promise<MonitorSummary> {
  const { id, ...data } = params;
  return makeRequest(
    "PATCH",
    `/api/monitors/${encodeURIComponent(id)}`,
    data
  ) as Promise<MonitorSummary>;
}

export async function toggleMonitor(params: {
  id: string;
  enabled: boolean;
}): Promise<{ id: string; enabled: boolean }> {
  return makeRequest(
    "POST",
    `/api/monitors/${encodeURIComponent(params.id)}/toggle`,
    { enabled: params.enabled }
  ) as Promise<{ id: string; enabled: boolean }>;
}

export async function deleteMonitor(
  id: string
): Promise<{ id: string; deleted: boolean }> {
  return makeRequest(
    "DELETE",
    `/api/monitors/${encodeURIComponent(id)}`
  ) as Promise<{ id: string; deleted: boolean }>;
}

import { makeRequest } from "./langwatch-api.js";

export interface AgentSummary {
  id: string;
  name: string;
  type: string;
  config: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentListResponse {
  data: AgentSummary[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export async function listAgents(params?: {
  page?: number;
  limit?: number;
}): Promise<AgentListResponse> {
  const query = new URLSearchParams();
  if (params?.page) query.set("page", String(params.page));
  if (params?.limit) query.set("limit", String(params.limit));
  const qs = query.toString() ? `?${query}` : "";
  return makeRequest("GET", `/api/agents${qs}`) as Promise<AgentListResponse>;
}

export async function getAgent(id: string): Promise<AgentSummary> {
  return makeRequest(
    "GET",
    `/api/agents/${encodeURIComponent(id)}`,
  ) as Promise<AgentSummary>;
}

export async function createAgent(data: {
  name: string;
  type: string;
  config: Record<string, unknown>;
}): Promise<AgentSummary> {
  return makeRequest("POST", "/api/agents", data) as Promise<AgentSummary>;
}

export async function updateAgent(params: {
  id: string;
  name?: string;
  type?: string;
  config?: Record<string, unknown>;
}): Promise<AgentSummary> {
  const { id, ...data } = params;
  return makeRequest(
    "PATCH",
    `/api/agents/${encodeURIComponent(id)}`,
    data,
  ) as Promise<AgentSummary>;
}

export async function deleteAgent(id: string): Promise<{ id: string; name: string }> {
  return makeRequest(
    "DELETE",
    `/api/agents/${encodeURIComponent(id)}`,
  ) as Promise<{ id: string; name: string }>;
}

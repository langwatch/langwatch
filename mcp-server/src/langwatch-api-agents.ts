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

/**
 * Run an agent. For HTTP agents, calls the configured URL directly.
 * For workflow-linked agents, calls the workflow run endpoint.
 */
export async function runAgent(
  id: string,
  input?: Record<string, unknown>,
): Promise<{ agentType: string; result: Record<string, unknown> }> {
  const agent = await getAgent(id);
  const config = agent.config ?? {};

  if (agent.type === "http") {
    const url = (config as Record<string, unknown>).url as string | undefined;
    if (!url) {
      throw new Error("HTTP agent has no URL configured");
    }

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input ?? {}),
    });

    const result = (await response.json()) as Record<string, unknown>;
    return { agentType: "http", result };
  }

  // For workflow-linked agents, use the workflow run endpoint
  const workflowId = (config as Record<string, unknown>).workflowId as string | undefined;
  if (!workflowId) {
    throw new Error(
      `Agent "${agent.name}" (type: ${agent.type}) cannot be executed directly. ` +
        `Only HTTP agents and workflow-linked agents can be run.`,
    );
  }

  const { runWorkflow } = await import("./langwatch-api-workflows.js");
  const result = await runWorkflow(workflowId, input);
  return { agentType: agent.type, result };
}

export async function deleteAgent(id: string): Promise<{ id: string; name: string }> {
  return makeRequest(
    "DELETE",
    `/api/agents/${encodeURIComponent(id)}`,
  ) as Promise<{ id: string; name: string }>;
}

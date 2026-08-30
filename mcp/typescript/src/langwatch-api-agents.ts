import { z } from "zod";

import { makeRequest } from "./langwatch-api.js";
import { requestPublicJson } from "./public-http-request.js";

/**
 * The run parameters a call carries: a flat record of scalars. The platform
 * declares run parameters as `string`, `number` or `boolean`, so a nested
 * object or an array is outside the contract and is refused here.
 */
export const agentCallParamsSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean()]),
);

export type AgentCallParams = z.infer<typeof agentCallParamsSchema>;

/**
 * One run parameter an agent declares, as the platform lists it. An agent
 * never declares a secret parameter: a secret belongs to the scenario and is
 * supplied per run.
 */
export interface AgentParameterSpec {
  name: string;
  type: "string" | "number" | "boolean";
  options?: string[];
  default?: string | number | boolean;
  description?: string;
  required?: boolean;
}

/** One process connected as an instance of a connected agent. */
export interface AgentInstance {
  id: string;
  hostname: string;
  label?: string | null;
  connectedAt: string;
}

export interface AgentSummary {
  id: string;
  name: string;
  type: string;
  config: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  /** Connected agents: the environment the SDK registered under. */
  environment?: string | null;
  /** Connected agents: online while at least one instance is connected. */
  status?: "online" | "offline" | null;
  instances?: AgentInstance[];
  lastSeenAt?: string | null;
  owner?: { userId: string; name: string } | null;
  hostLabel?: string | null;
  parameters?: AgentParameterSpec[];
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

/** One conversation message as the relay carries it, OpenAI style. */
export interface AgentCallMessage {
  role: string;
  content?: unknown;
  [key: string]: unknown;
}

/** The body `POST /api/v1/agents/:id/call` takes. */
export interface AgentCallBody {
  messages: AgentCallMessage[];
  newMessages?: AgentCallMessage[];
  threadId?: string;
  params?: AgentCallParams;
  session?: unknown;
  traceparent?: string;
}

/** The reply of the relay: the function's output and the instance that ran it. */
export interface AgentCallResponse {
  output: unknown;
  session?: unknown;
  instance: { hostname: string; label?: string | null };
  durationMs: number;
}

export async function listAgents(params?: {
  page?: number;
  limit?: number;
}): Promise<AgentListResponse> {
  const query = new URLSearchParams();
  if (params?.page) query.set("page", String(params.page));
  if (params?.limit) query.set("limit", String(params.limit));
  const qs = query.toString() ? `?${query}` : "";
  return makeRequest("GET", `/api/v1/agents${qs}`) as Promise<AgentListResponse>;
}

export async function getAgent(id: string): Promise<AgentSummary> {
  return makeRequest(
    "GET",
    `/api/v1/agents/${encodeURIComponent(id)}`,
  ) as Promise<AgentSummary>;
}

export async function createAgent(data: {
  name: string;
  type: string;
  config: Record<string, unknown>;
}): Promise<AgentSummary> {
  return makeRequest("POST", "/api/v1/agents", data) as Promise<AgentSummary>;
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
    `/api/v1/agents/${encodeURIComponent(id)}`,
    data,
  ) as Promise<AgentSummary>;
}

/**
 * Runs one turn of a connected agent through the relay: the platform
 * dispatches it to a live instance and answers with the function's output.
 */
export async function callAgent({
  id,
  body,
}: {
  id: string;
  body: AgentCallBody;
}): Promise<AgentCallResponse> {
  return makeRequest(
    "POST",
    `/api/v1/agents/${encodeURIComponent(id)}/call`,
    body,
  ) as Promise<AgentCallResponse>;
}

/** The ids `POST /api/v1/agents/:id/test` answers with. */
export interface AgentTestRunResponse {
  scenarioRunId: string;
  batchRunId: string;
  setId: string;
}

/**
 * Runs one scripted scenario against an agent: the user sends "ping", the
 * agent answers, and the run succeeds when the answer arrives. The project
 * gains no scenario, run plan or test suite, and the answer carries the run
 * ids to follow.
 */
export async function testAgent(id: string): Promise<AgentTestRunResponse> {
  return makeRequest(
    "POST",
    `/api/v1/agents/${encodeURIComponent(id)}/test`,
    {},
  ) as Promise<AgentTestRunResponse>;
}

const isMessageList = (value: unknown): value is AgentCallMessage[] =>
  Array.isArray(value) &&
  value.every(
    (item) =>
      typeof item === "object" && item !== null && typeof (item as AgentCallMessage).role === "string",
  );

/**
 * The relay body for a connected agent: `message` is one user turn, `input`
 * is the body itself (it must carry `messages`), `parameters` are the run
 * parameters and `threadId` continues a conversation. A string is the
 * refusal, so the tool can answer it.
 */
export function buildRelayBody({
  input,
  message,
  parameters,
  threadId,
}: {
  input: Record<string, unknown>;
  message?: string;
  parameters?: AgentCallParams;
  threadId?: string;
}): AgentCallBody | string {
  let messages: AgentCallMessage[];
  if (message !== undefined) {
    messages = [{ role: "user", content: message }];
  } else if (isMessageList(input.messages)) {
    messages = input.messages;
  } else {
    return "a connected agent takes a conversation: give `message`, or `input` with a `messages` list.";
  }
  const body: AgentCallBody = { messages };
  const thread = threadId ?? (typeof input.threadId === "string" ? input.threadId : undefined);
  if (thread) body.threadId = thread;
  if (isMessageList(input.newMessages)) body.newMessages = input.newMessages;
  if (input.session !== undefined) body.session = input.session;
  let inputParams: AgentCallParams | undefined;
  if (input.params !== undefined) {
    const parsed = agentCallParamsSchema.safeParse(input.params);
    if (!parsed.success) {
      return "`params` takes one flat object of string, number or boolean values. Nested objects and arrays are not run parameters.";
    }
    inputParams = parsed.data;
  }
  if (inputParams || parameters) body.params = { ...(inputParams ?? {}), ...(parameters ?? {}) };
  return body;
}

/**
 * Run an agent. A connected agent runs one turn through the relay; an HTTP
 * agent is called at its URL; a workflow-linked agent runs on the workflow
 * engine.
 */
export async function runAgent({
  id,
  input,
  message,
  parameters,
  threadId,
}: {
  id: string;
  input?: Record<string, unknown>;
  message?: string;
  parameters?: AgentCallParams;
  threadId?: string;
}): Promise<{ agentType: string; result: Record<string, unknown> }> {
  const agent = await getAgent(id);
  const config = agent.config ?? {};

  if (agent.type === "connected") {
    const body = buildRelayBody({ input: input ?? {}, message, parameters, threadId });
    if (typeof body === "string") throw new Error(body);
    if (agent.status === "offline") {
      throw new Error(
        `Agent "${agent.name}" is offline. Start the process that calls connectAgent (or connect_agent) and try again.`,
      );
    }
    const result = await callAgent({ id: agent.id, body });
    return { agentType: "connected", result: result as unknown as Record<string, unknown> };
  }

  if (agent.type === "http") {
    const url = (config as Record<string, unknown>).url as string | undefined;
    if (!url) {
      throw new Error("HTTP agent has no URL configured");
    }

    const result = await requestPublicJson(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input ?? {}),
    });

    return { agentType: "http", result };
  }

  // For workflow-linked agents, use the workflow run endpoint
  const workflowId = (config as Record<string, unknown>).workflowId as string | undefined;
  if (!workflowId) {
    throw new Error(
      `Agent "${agent.name}" (type: ${agent.type}) cannot be executed directly. ` +
        `Only connected agents, HTTP agents and workflow-linked agents can be run.`,
    );
  }

  const { runWorkflow } = await import("./langwatch-api-workflows.js");
  const result = await runWorkflow(workflowId, input);
  return { agentType: agent.type, result };
}

export async function deleteAgent(id: string): Promise<{ id: string; name: string }> {
  return makeRequest(
    "DELETE",
    `/api/v1/agents/${encodeURIComponent(id)}`,
  ) as Promise<{ id: string; name: string }>;
}

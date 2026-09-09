import type { TraceApi } from "@langwatch/trace-contract";
import type { WorkflowApi } from "@langwatch/workflow-contract";
import {
  buildHttpNodeParameters,
  type HttpAgentTestInput,
  type HttpAuth,
  type HttpHeader,
  type HttpProxyResult,
} from "@langwatch/agent-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";
import {
  LATEST_SPEC_VERSION,
  type BaseComponent,
  type Field,
  type StudioWorkflow,
} from "@langwatch/workflow-contract";
import { nanoid } from "nanoid";
import {
  buildAgentTestTrace,
  buildTraceparentHeader,
  buildTraceTestContext,
  generateTraceIds,
} from "../rules/agent-test-tracing.rules.ts";

const logger = createLogger("langwatch:httpProxy");
type ExecutionState = NonNullable<BaseComponent["execution_state"]>;

export class HttpAgentTestService {
  readonly #workflows: WorkflowApi;
  readonly #traces: TraceApi;

  static create(peers: { workflows: WorkflowApi; traces: TraceApi }): HttpAgentTestService {
    return new HttpAgentTestService(peers);
  }

  private constructor(peers: { workflows: WorkflowApi; traces: TraceApi }) {
    this.#workflows = peers.workflows;
    this.#traces = peers.traces;
  }

  async execute(input: HttpAgentTestInput & { actorId: string }): Promise<HttpProxyResult> {
    const { projectId, agentId, bodyTemplate, templateVariables = {}, ...call } = input;
    const traceIds = agentId ? generateTraceIds() : void 0;
    const headers = [...(call.headers ?? [])];
    if (traceIds) {
      headers.push({ key: "traceparent", value: buildTraceparentHeader(traceIds) });
    }

    const nodeId = "http_agent_test";
    const workflow = buildAgentTestWorkflow({
      nodeId,
      variables: templateVariables,
      parameters: buildHttpNodeParameters({ ...call, headers, bodyTemplate }),
    });
    const traceId = traceIds?.traceId ?? `agent-test-${nanoid(12)}`;
    const startedAt = nowInstant().epochMilliseconds;

    let result: HttpProxyResult;
    try {
      const state = await this.#executeNode({
        projectId,
        nodeId,
        workflow,
        traceId,
        inputs: templateVariables,
      });
      result = toProxyResult(state, nowInstant().epochMilliseconds - startedAt);
    } catch {
      // Dispatch errors can contain credentials and internal addresses. Only engine node
      // errors are customer-facing; transport failures remain a generic failed test.
      logger.error({ projectId, agentId }, "agent test dispatch failed");
      result = { success: false };
    }

    if (agentId) {
      const trace = buildAgentTestTrace({
        agentId,
        userId: input.actorId,
        traceId: traceIds?.traceId,
        spanId: traceIds?.spanId,
        testContext: buildTraceTestContext(input),
        requestBody: result.renderedBody ?? "",
        requestHeaders: tracedRequestHeaders(headers, input.auth),
        customAuthHeaderName: input.auth?.type === "api_key" ? input.auth.header : void 0,
        result,
      });
      try {
        await this.#traces.recordCapturedSpan({
          projectId,
          span: trace.span,
          customMetadata: trace.customMetadata,
          userId: trace.userId,
          occurredAt: trace.occurredAt,
        });
      } catch {
        // A failed history write must not turn a completed outbound request into a retry.
        logger.error({ projectId, agentId, traceId }, "failed to create agent test trace");
      }
    }

    return result;
  }

  async #executeNode(input: {
    projectId: string;
    nodeId: string;
    workflow: StudioWorkflow;
    traceId: string;
    inputs: Record<string, unknown>;
  }): Promise<ExecutionState> {
    return this.#workflows.executeComponent({
      ...input,
      workflow: { ...input.workflow, state: { execution: { status: "idle" } } },
      origin: "agent_test",
    });
  }
}

function fieldTypeFor(value: unknown): Field["type"] {
  if (Array.isArray(value)) return "list";
  if (value !== null && typeof value === "object") return "dict";
  return "str";
}

function buildAgentTestWorkflow(input: {
  nodeId: string;
  parameters: Field[];
  variables: Record<string, unknown>;
}): StudioWorkflow {
  return {
    spec_version: LATEST_SPEC_VERSION,
    workflow_id: `agent_test_${nanoid(8)}`,
    name: "Agent test",
    icon: "🔌",
    description: "One HTTP agent invocation from the agent editor",
    version: "1.0",
    template_adapter: "default",
    // The feature records one agent-test trace, so disable the engine's workflow trace.
    enable_tracing: false,
    nodes: [
      {
        id: input.nodeId,
        type: "http",
        position: { x: 0, y: 0 },
        data: {
          name: "HTTP agent",
          inputs: Object.entries(input.variables).map(([identifier, value]) => ({
            identifier,
            type: fieldTypeFor(value),
          })),
          outputs: [{ identifier: "output", type: "str" }],
          parameters: input.parameters,
        },
      },
    ],
    edges: [],
    state: {},
  };
}

function toProxyResult(state: ExecutionState, fallbackDuration: number): HttpProxyResult {
  const { started_at: startedAt, finished_at: finishedAt } = state.timestamps ?? {};
  const detail = {
    status: state.http?.status_code ?? state.upstream_status,
    statusText: state.http?.status_text,
    responseHeaders: state.http?.response_headers,
    renderedBody: state.http?.rendered_body,
    warnings: state.http?.warnings,
    duration:
      startedAt !== void 0 && finishedAt !== void 0 ? finishedAt - startedAt : fallbackDuration,
  };

  if (state.status === "error" || state.error) {
    return {
      ...detail,
      success: false,
      errorCode: state.error_type,
      error: state.error ?? "The request failed",
    };
  }

  const extracted = Object.values(state.outputs ?? {})[0];
  const extractedOutput =
    extracted === null || extracted === void 0 ? void 0 : stringifyOutput(extracted);
  return {
    ...detail,
    success: true,
    response: extracted,
    extractedOutput,
  };
}

function stringifyOutput(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function tracedRequestHeaders(headers: HttpHeader[], auth?: HttpAuth): Record<string, string> {
  const traced: Record<string, string> = {
    "Content-Type": "application/json",
    ...Object.fromEntries(headers.map(({ key, value }) => [key.trim(), value])),
  };
  switch (auth?.type) {
    case "bearer":
      traced.Authorization = "Bearer redacted";
      break;
    case "basic":
      traced.Authorization = "Basic redacted";
      break;
    case "api_key":
      traced[auth.header] = "redacted";
      break;
  }
  return traced;
}

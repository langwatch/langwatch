import { createLogger } from "@langwatch/observability";
import { nanoid } from "nanoid";
import { z } from "zod";
import { studioBackendPostEvent } from "~/app/api/workflows/post_event/post-event";
import type { RequestAppServices } from "~/runtime/app/requestApp";
import {
  type BaseComponent,
  type Field,
  HTTP_METHODS,
  httpAuthSchema,
  httpHeaderSchema,
  LATEST_SPEC_VERSION,
  type StudioWorkflow,
} from "@langwatch/workflow-contract";
import type { StudioServerEvent } from "@langwatch/workflow-contract";
import { buildHttpNodeParameters } from "~/server/agents/http-node";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import {
  buildTraceparentHeader,
  buildTraceTestContext,
  createAgentTestTrace,
  generateTraceIds,
} from "./httpProxyTracing";

const logger = createLogger("langwatch:httpProxy");

type HttpProxyResult = {
  success: boolean;
  error?: string;
  /** The engine's stable failure code, which the panel presents copy from. */
  errorCode?: string;
  response?: unknown;
  extractedOutput?: string;
  status?: number;
  statusText?: string;
  duration?: number;
  responseHeaders?: Record<string, string>;
  /** The request body the engine sent, after templating. */
  renderedBody?: string;
  /** Template variables the body referenced but the test did not supply. */
  warnings?: string[];
};

/**
 * Runs one HTTP agent the way an evaluation would.
 *
 * The request itself is not made here. It is dispatched to the workflow engine
 * as the same `http` node an evaluation builds, so testing an agent and running
 * it exercise one client, one SSRF policy, one template renderer, one auth
 * implementation and one JSONPath extractor.
 *
 * This used to be a second HTTP client living in the app, and the two drifted
 * exactly where it hurt: the engine refused private addresses whatever
 * BLOCK_LOCAL_HTTP_CALLS said, so an agent on an internal network tested green
 * here and then failed its evaluation as a blocked address. The app also
 * substituted `{{var}}` with a plain string replace that did not match
 * `{{ var }}`, so a template written the way the engine reads it was sent to
 * the endpoint with the braces still in it.
 *
 * Used by the test button in the HTTP agent drawer and properties panels.
 */
export const httpProxyRouter = createTRPCRouter({
  execute: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        agentId: z.string().optional(),
        url: z.string().url(),
        method: z.enum(HTTP_METHODS),
        headers: z.array(httpHeaderSchema).optional(),
        auth: httpAuthSchema.optional(),
        /**
         * The template, not a rendered body. The engine renders it, so what
         * the endpoint receives here is what it receives in a real run.
         */
        bodyTemplate: z.string(),
        /** Values the template is rendered against, e.g. threadId, messages. */
        templateVariables: z.record(z.string(), z.any()).optional(),
        outputPath: z.string().optional(),
        timeoutMs: z.number().positive().optional(),
      }),
    )
    .permission("evaluations:manage")
    .mutation(async ({ input, ctx }): Promise<HttpProxyResult> => {
      const { projectId, agentId, bodyTemplate, templateVariables = {}, ...call } = input;

      // Generated up front so the traceparent can ride along on the request
      // and the customer's agent can correlate its own spans with the test.
      const traceIds = agentId ? generateTraceIds() : undefined;
      const headers = [...(call.headers ?? [])];
      if (traceIds) {
        headers.push({
          key: "traceparent",
          value: buildTraceparentHeader(traceIds),
        });
      }

      const nodeId = "http_agent_test";
      const workflow = buildAgentTestWorkflow({
        nodeId,
        variables: templateVariables,
        parameters: buildHttpNodeParameters({ ...call, headers, bodyTemplate }),
      });

      const traceId = traceIds?.traceId ?? `agent-test-${nanoid(12)}`;
      const startedAt = Date.now();

      let result: HttpProxyResult;
      try {
        const state = await runNode({
          projectId,
          nodeId,
          workflow,
          traceId,
          inputs: templateVariables,
          nlpLambda: ctx.app.nlpLambda,
          modelProviders: ctx.app.modelProviders,
          workflows: ctx.app.workflows,
        });
        result = toProxyResult({
          state,
          fallbackDuration: Date.now() - startedAt,
        });
      } catch (err) {
        // Failing to reach the engine is our problem, not the author's, and its
        // message is a transport detail that can name an internal host and
        // port. It is logged and it degrades to the generic failure, which is
        // ADR-045: only a coded failure gets words written for it. The engine's
        // own messages, which are what the author needs, arrive on the node's
        // state below and are not this path.
        logger.error({ err, projectId, agentId }, "agent test dispatch failed");
        result = { success: false };
      }

      await recordTestTrace({ input, traceIds, headers, result, ctx });
      return result;
    }),
});

/**
 * A workflow holding nothing but the node under test.
 *
 * The node's inputs are declared from the supplied variable names so the
 * engine binds each one before rendering the body; their values travel in the
 * event's `inputs` rather than on the node.
 */
const buildAgentTestWorkflow = ({
  nodeId,
  parameters,
  variables,
}: {
  nodeId: string;
  parameters: ReturnType<typeof buildHttpNodeParameters>;
  variables: Record<string, unknown>;
}): StudioWorkflow => ({
  spec_version: LATEST_SPEC_VERSION,
  workflow_id: `agent_test_${nanoid(8)}`,
  name: "Agent test",
  icon: "🔌",
  description: "One HTTP agent invocation from the agent editor",
  version: "1.0",
  template_adapter: "default",
  // The test writes its own trace (see createAgentTestTrace) so the author
  // sees one span for one click, not the engine's workflow trace as well.
  enable_tracing: false,
  nodes: [
    {
      id: nodeId,
      type: "http",
      position: { x: 0, y: 0 },
      data: {
        name: "HTTP agent",
        inputs: Object.entries(variables).map(([identifier, value]) => ({
          identifier,
          type: fieldTypeFor(value),
        })),
        outputs: [{ identifier: "output", type: "str" as const }],
        parameters,
      },
    },
  ] as StudioWorkflow["nodes"],
  edges: [],
  state: {},
});

/**
 * The field type matching a value's shape.
 *
 * It decides how the engine interpolates the variable: a string is escaped to
 * sit inside a JSON string literal, while structured data is written as JSON.
 * Declaring a list of messages as text would send the endpoint a body with
 * every quote backslashed, which is the sort of thing that reads as "the agent
 * is broken" rather than "the variable was the wrong type".
 */
const fieldTypeFor = (value: unknown): Field["type"] => {
  if (Array.isArray(value)) return "list";
  if (value !== null && typeof value === "object") return "dict";
  return "str";
};

/** Dispatches the node and returns the state the engine finished it in. */
const runNode = async ({
  projectId,
  nodeId,
  workflow,
  traceId,
  inputs,
  nlpLambda,
  modelProviders,
  workflows,
}: {
  projectId: string;
  nodeId: string;
  workflow: StudioWorkflow;
  traceId: string;
  inputs: Record<string, unknown>;
  nlpLambda: import("~/runtime/api/nlp-lambda").NlpLambdaRuntime;
  modelProviders: import("@langwatch/model-provider-contract").ModelProviderService;
  workflows: import("@langwatch/workflow-contract").WorkflowService;
}): Promise<NonNullable<BaseComponent["execution_state"]>> => {
  const event = {
    type: "execute_component" as const,
    payload: {
      trace_id: traceId,
      workflow: {
        ...workflow,
        state: { execution: { status: "idle" as const } },
      },
      node_id: nodeId,
      inputs,
      origin: "agent_test",
    },
  };

  let state: BaseComponent["execution_state"];
  await studioBackendPostEvent({
    projectId,
    nlpLambda,
    modelProviders,
    message: await workflows.enrichStudioEvent({ event, projectId }),
    onEvent: (serverEvent: StudioServerEvent) => {
      // Keep the last state the node reported; the engine streams it as the
      // node moves from running to its terminal status.
      if (
        serverEvent.type === "component_state_change" &&
        serverEvent.payload.component_id === nodeId
      ) {
        state = serverEvent.payload.execution_state;
      }
      if (serverEvent.type === "error") {
        throw new Error(serverEvent.payload.message);
      }
    },
  });

  if (!state) {
    throw new Error("The engine reported no result for this request");
  }
  return state;
};

/**
 * Maps the node's finished state onto what the test panel shows.
 *
 * A node that failed still carries its response detail, because the status and
 * body of a failing endpoint are exactly what the author needs to read.
 */
const toProxyResult = ({
  state,
  fallbackDuration,
}: {
  state: NonNullable<BaseComponent["execution_state"]>;
  fallbackDuration: number;
}): HttpProxyResult => {
  const http = state.http;
  const detail = {
    status: http?.status_code ?? state.upstream_status,
    statusText: http?.status_text,
    responseHeaders: http?.response_headers,
    renderedBody: http?.rendered_body,
    warnings: http?.warnings,
    // Both ends or neither: subtracting a missing start from a real finish
    // would report the epoch as a duration, which the panel renders as a
    // request that took fifty-odd years.
    duration: durationOf(state.timestamps) ?? fallbackDuration,
  };

  if (state.status === "error" || state.error) {
    return {
      ...detail,
      success: false,
      // Both: the code is what the customer reads copy from, the message is
      // the engine's own words, which is what the person debugging their own
      // endpoint is actually looking for.
      errorCode: state.error_type,
      error: state.error ?? "The request failed",
    };
  }

  // The engine binds the node's single declared output, so whatever the output
  // path selected arrives under that one key.
  const extracted = Object.values(state.outputs ?? {})[0];

  return {
    ...detail,
    success: true,
    response: extracted,
    extractedOutput:
      typeof extracted === "string" ? extracted : stringifyOutput(extracted),
  };
};

const durationOf = (
  timestamps: NonNullable<BaseComponent["execution_state"]>["timestamps"],
): number | undefined =>
  timestamps?.started_at !== undefined && timestamps.finished_at !== undefined
    ? timestamps.finished_at - timestamps.started_at
    : undefined;

/**
 * The headers the engine will send, as the trace should record them.
 *
 * Auth credentials are named rather than encoded: the scheme is what the trace
 * needs and rebuilding the real value here would be a second implementation of
 * the engine's credential encoding. Values on the headers themselves are the
 * author's own text, and `sanitizeHeadersForTrace` is what decides which of
 * those are too credential-shaped to keep.
 */
const tracedRequestHeaders = ({
  headers,
  auth,
}: {
  headers: z.infer<typeof httpHeaderSchema>[];
  auth: z.infer<typeof httpAuthSchema> | undefined;
}): Record<string, string> => {
  const traced: Record<string, string> = {
    "Content-Type": "application/json",
    ...Object.fromEntries(headers.map(({ key, value }) => [key, value])),
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
    default:
      break;
  }

  return traced;
};

const stringifyOutput = (value: unknown): string | undefined => {
  if (value === undefined || value === null) return undefined;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

/**
 * Records the agent-test trace, which is what the agent's test history reads.
 * A tracing failure must never turn a working test into a failed one.
 */
const recordTestTrace = async ({
  input,
  traceIds,
  headers,
  result,
  ctx,
}: {
  input: {
    projectId: string;
    agentId?: string;
    url: string;
    method: (typeof HTTP_METHODS)[number];
    auth?: z.infer<typeof httpAuthSchema>;
    outputPath?: string;
  };
  traceIds: ReturnType<typeof generateTraceIds> | undefined;
  headers: z.infer<typeof httpHeaderSchema>[];
  result: HttpProxyResult;
  ctx: {
    session: { user: { id: string } };
    app: RequestAppServices;
  };
}) => {
  const { agentId, projectId, url, method, auth, outputPath } = input;
  if (!agentId) return;

  try {
    await createAgentTestTrace({
      traces: ctx.app.traces,
      projectId,
      agentId,
      userId: ctx.session.user.id,
      traceId: traceIds?.traceId,
      spanId: traceIds?.spanId,
      testContext: buildTraceTestContext({ url, method, auth, outputPath }),
      requestBody: result.renderedBody ?? "",
      requestHeaders: tracedRequestHeaders({ headers, auth }),
      customAuthHeaderName: auth?.type === "api_key" ? auth.header : undefined,
      result,
    });
  } catch (traceError) {
    logger.error({ traceError }, "failed to create agent test trace");
  }
};

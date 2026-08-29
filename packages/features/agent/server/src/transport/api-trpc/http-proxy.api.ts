/**
 * The HTTP agent test button, over the process's tRPC transport.
 *
 * Owned by the agent vertical rather than by workflows or traces: the subject
 * of the procedure is one HTTP agent. Its input is that agent's own
 * configuration, its output is what the agent's test panel renders, and its
 * side effect is the agent's test-history trace. The workflow engine and the
 * trace collector are both reached through, not what this is about — and the
 * node shape it builds already belongs to `@langwatch/agent-contract`.
 *
 * ## The request is not made here
 *
 * It is dispatched to the workflow engine as the same `http` node an
 * evaluation builds, so testing an agent and running it exercise one client,
 * one SSRF policy, one template renderer, one auth implementation and one
 * JSONPath extractor.
 *
 * This used to be a second HTTP client living in the app, and the two drifted
 * exactly where it hurt: the engine refused private addresses whatever
 * BLOCK_LOCAL_HTTP_CALLS said, so an agent on an internal network tested green
 * here and then failed its evaluation as a blocked address. The app also
 * substituted `{{var}}` with a plain string replace that did not match
 * `{{ var }}`, so a template written the way the engine reads it was sent to
 * the endpoint with the braces still in it.
 *
 * ## The gate IS the authorization
 *
 * The endpoint reaches a caller-supplied URL. Nothing downstream re-checks who
 * asked, so `evaluations:manage` — the permission that lets somebody author
 * the agent this tests — is the only thing between a member and an outbound
 * request from our network. It is not a coarse pre-filter.
 */
import { buildHttpNodeParameters } from "@langwatch/agent-contract";
import type { AuthzPermission } from "@langwatch/authz-contract";
import { createLogger } from "@langwatch/observability";
import {
  HTTP_METHODS,
  httpAuthSchema,
  httpHeaderSchema,
  LATEST_SPEC_VERSION,
  type BaseComponent,
  type Field,
  type StudioClientEvent,
  type StudioServerEvent,
  type StudioWorkflow,
} from "@langwatch/workflow-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  buildAgentTestTrace,
  buildTraceparentHeader,
  buildTraceTestContext,
  generateTraceIds,
  type AgentTestTrace,
} from "./agent-test-tracing";

const logger = createLogger("langwatch:httpProxy");

/** What the test panel renders for one run. */
export type HttpProxyResult = {
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
 * The per-request handle the process's dispatch and ingestion need. Opaque
 * here on purpose: only the process knows what identifies a caller to its own
 * engine client and collector, and this transport never reads it.
 */
export type HttpProxyTrpcRequest = unknown;

/** The process supplies authentication; authorization arrives as `policy`. */
export type HttpProxyTrpcContext = Readonly<{
  actor(): Readonly<{ id: string }>;
}>;

type HttpProxyTrpcProcedures<
  TContext extends HttpProxyTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The process's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /**
   * The process's tracing, logging, error, scope-lineage, authorization and
   * audit policy for one declared permission.
   *
   * Applied by this feature AFTER its own input parser rather than composed
   * ahead of it, because the authorization check reads its scope id from the
   * validated input: tRPC runs middlewares in the order they were added, so a
   * check installed before `.input()` would see no input at all.
   */
  policy(permission: AuthzPermission): <TProcedure>(procedure: TProcedure) => TProcedure;
}>;

/** The process capabilities this transport needs; neither is the agent's own. */
export type HttpProxyTrpcPorts = Readonly<{
  /**
   * Dispatches one studio event to the workflow engine, streaming the engine's
   * server events back as they arrive. Enrichment (the engine's per-project
   * context) is the process's too, so the event goes in unenriched.
   */
  postStudioEvent(
    request: HttpProxyTrpcRequest,
    input: Readonly<{
      projectId: string;
      event: StudioClientEvent;
      onEvent(event: StudioServerEvent): void;
    }>,
  ): Promise<void>;
  /** Ingests the agent-test span the feature built. */
  recordAgentTestTrace(
    request: HttpProxyTrpcRequest,
    input: Readonly<{ projectId: string; trace: AgentTestTrace }>,
  ): Promise<void>;
}>;

const executeInputSchema = z.object({
  projectId: z.string(),
  agentId: z.string().optional(),
  url: z.string().url(),
  method: z.enum(HTTP_METHODS),
  headers: z.array(httpHeaderSchema).optional(),
  auth: httpAuthSchema.optional(),
  /**
   * The template, not a rendered body. The engine renders it, so what the
   * endpoint receives here is what it receives in a real run.
   */
  bodyTemplate: z.string(),
  /** Values the template is rendered against, e.g. threadId, messages. */
  templateVariables: z.record(z.string(), z.any()).optional(),
  outputPath: z.string().optional(),
  timeoutMs: z.number().positive().optional(),
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
  // The test writes its own trace (see buildAgentTestTrace) so the author sees
  // one span for one click, not the engine's workflow trace as well.
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

const durationOf = (
  timestamps: NonNullable<BaseComponent["execution_state"]>["timestamps"],
): number | undefined =>
  timestamps?.started_at !== undefined && timestamps.finished_at !== undefined
    ? timestamps.finished_at - timestamps.started_at
    : undefined;

const stringifyOutput = (value: unknown): string | undefined => {
  if (value === undefined || value === null) return undefined;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
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
    extractedOutput: typeof extracted === "string" ? extracted : stringifyOutput(extracted),
  };
};

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

/** Installs the complete `httpProxy.*` tRPC surface on a process-owned root. */
export class HttpProxyTrpcApi {
  static create<
    TContext extends HttpProxyTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: HttpProxyTrpcProcedures<TContext, TOptions, TRoot>,
    ports: HttpProxyTrpcPorts,
  ) {
    const { protected: procedure, policy } = procedures;

    /** Dispatches the node and returns the state the engine finished it in. */
    const runNode = async ({
      request,
      projectId,
      nodeId,
      workflow,
      traceId,
      inputs,
    }: {
      request: HttpProxyTrpcRequest;
      projectId: string;
      nodeId: string;
      workflow: StudioWorkflow;
      traceId: string;
      inputs: Record<string, unknown>;
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
      } satisfies StudioClientEvent;

      let state: BaseComponent["execution_state"];
      await ports.postStudioEvent(request, {
        projectId,
        event,
        onEvent: (serverEvent: StudioServerEvent) => {
          // Keep the last state the node reported; the engine streams it as
          // the node moves from running to its terminal status.
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
     * Records the agent-test trace, which is what the agent's test history
     * reads. A tracing failure must never turn a working test into a failed
     * one.
     */
    const recordTestTrace = async ({
      request,
      input,
      userId,
      traceIds,
      headers,
      result,
    }: {
      request: HttpProxyTrpcRequest;
      input: z.infer<typeof executeInputSchema>;
      userId: string;
      traceIds: ReturnType<typeof generateTraceIds> | undefined;
      headers: z.infer<typeof httpHeaderSchema>[];
      result: HttpProxyResult;
    }) => {
      const { agentId, projectId, url, method, auth, outputPath } = input;
      if (!agentId) return;

      try {
        await ports.recordAgentTestTrace(request, {
          projectId,
          trace: buildAgentTestTrace({
            agentId,
            userId,
            traceId: traceIds?.traceId,
            spanId: traceIds?.spanId,
            testContext: buildTraceTestContext({ url, method, auth, outputPath }),
            requestBody: result.renderedBody ?? "",
            requestHeaders: tracedRequestHeaders({ headers, auth }),
            customAuthHeaderName: auth?.type === "api_key" ? auth.header : undefined,
            result,
          }),
        });
      } catch (traceError) {
        logger.error({ traceError }, "failed to create agent test trace");
      }
    };

    return trpc.router({
      execute: policy("evaluations:manage")(procedure.input(executeInputSchema)).mutation(
        async ({ input, ctx }): Promise<HttpProxyResult> => {
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
              request: ctx,
              projectId,
              nodeId,
              workflow,
              traceId,
              inputs: templateVariables,
            });
            result = toProxyResult({
              state,
              fallbackDuration: Date.now() - startedAt,
            });
          } catch (err) {
            // Failing to reach the engine is our problem, not the author's, and
            // its message is a transport detail that can name an internal host
            // and port. It is logged and it degrades to the generic failure,
            // which is ADR-045: only a coded failure gets words written for it.
            // The engine's own messages, which are what the author needs,
            // arrive on the node's state above and are not this path.
            logger.error({ err, projectId, agentId }, "agent test dispatch failed");
            result = { success: false };
          }

          await recordTestTrace({
            request: ctx,
            input,
            userId: ctx.actor().id,
            traceIds,
            headers,
            result,
          });
          return result;
        },
      ),
    });
  }
}

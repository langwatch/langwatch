/**
 * `POST /api/v1/agents/:id/call`: one turn to a connected agent, answered
 * with the function's output (ADR-128, "Transport").
 *
 * The scenario child calls it with the project key, and so do the Test
 * panel, `langwatch agent run` and MCP. The endpoint needs `scenarios:create`
 * and the agent's own project; it dispatches to a live instance and answers,
 * or refuses with one of the handled errors the contract names.
 */

import {
  AgentBusyError,
  AgentNotFoundError,
  AgentPayloadTooLargeError,
  agentTypeSchema,
  callRunSchema,
  DEFAULT_CALL_TIMEOUT_MS,
  MAX_CALL_TIMEOUT_MS,
  messageSchema,
  outputSchema,
  paramsSchema,
  relayPayloadCaps,
  type ConnectedAgentConfig,
  type DispatchAgent,
  type DispatchCall,
} from "@langwatch/agent-contract";
import { requires } from "@langwatch/api";
import {
  bodyLimit,
  type AppRestProjectVariables,
  type SecuredApp,
  validator as zValidator,
} from "@langwatch/api/rest";
import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";

import { AgentApp } from "#app/agent.app";
import type { ConnectedAgentRuntime } from "../../services/connected-agent-runtime.service";

export const relayCallBodySchema = z.object({
  messages: z.array(messageSchema).describe("The whole conversation so far, OpenAI style."),
  newMessages: z
    .array(messageSchema)
    .optional()
    .describe("The messages added since the agent's last turn. Defaults to the last message."),
  threadId: z
    .string()
    .max(255)
    .optional()
    .describe(
      "The conversation id. Turns of one conversation share it; a new id starts a new one.",
    ),
  params: paramsSchema.optional().describe("Run parameter values by name, as JSON scalars."),
  session: z
    .unknown()
    .optional()
    .describe(
      "The session the agent returned on its previous turn of this conversation, echoed back as is.",
    ),
  traceparent: z
    .string()
    .max(255)
    .optional()
    .describe("The W3C trace context the agent adopts, so its spans join this turn's trace."),
  run: callRunSchema.optional().describe("The simulation run this turn belongs to, if any."),
});

export const relayCallResponseSchema = z.object({
  output: outputSchema.describe(
    "What the function answered: text, one message, or a list of messages.",
  ),
  session: z
    .unknown()
    .optional()
    .describe("The agent's per-conversation memory, to send on the next turn."),
  instance: z.object({
    hostname: z.string(),
    label: z.string().nullable(),
  }),
  durationMs: z.number(),
});

const idParamsSchema = z.object({
  id: z.string().min(1).describe("The connected agent id."),
});

/**
 * Refuses a personal development agent of someone other than the caller.
 *
 * A port because the check reaches the Suite feature's own
 * `assertConnectedAgentsRunnable`, which `@langwatch/agent-server` may not
 * import (strict feature layout); the process composes it from
 * `@langwatch/suite-server` in `apps/api`.
 */
export type AssertConnectedAgentsRunnablePort = (input: {
  agent: { id: string; name: string; type: string; ownerUserId?: string | null };
  apiKeyUserId: string | undefined;
}) => Promise<void>;

export interface AgentCallDeps {
  agents: () => AgentApp;
  runtime: () => ConnectedAgentRuntime;
  assertRunnable: AssertConnectedAgentsRunnablePort;
  /** `LANGWATCH_AGENT_RELAY_MAX_PAYLOAD_MB`; the default cap when absent. */
  relayMaxPayloadMb?: number;
}

/** The agent the dispatcher needs, with the per-call budget capped. */
function dispatchAgentOf({
  agent,
  config,
}: {
  agent: { id: string; name: string; environment: string | null };
  config: ConnectedAgentConfig;
}): DispatchAgent {
  return {
    id: agent.id,
    name: agent.name,
    environment: agent.environment,
    timeoutMs: Math.min(config.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS, MAX_CALL_TIMEOUT_MS),
    isSticky: config.sticky ?? false,
  };
}

/** One turn as the dispatcher reads it, with the body defaults filled in. */
function dispatchCallOf({
  body,
  traceparentHeader,
}: {
  body: z.infer<typeof relayCallBodySchema>;
  traceparentHeader: string | null;
}): DispatchCall {
  return {
    threadId: body.threadId ?? crypto.randomUUID(),
    messages: body.messages,
    newMessages: body.newMessages ?? body.messages.slice(-1),
    params: body.params ?? {},
    session: body.session,
    traceparent: body.traceparent ?? traceparentHeader,
    run: body.run ?? {},
  };
}

/** One turn through the dispatcher, answered in the wire shape. */
async function dispatchTurn({
  runtime,
  projectId,
  agent,
  call,
  signal,
}: {
  runtime: ConnectedAgentRuntime;
  projectId: string;
  agent: {
    id: string;
    name: string;
    environment: string | null;
    config: unknown;
  };
  call: DispatchCall;
  signal: AbortSignal;
}): Promise<z.infer<typeof relayCallResponseSchema>> {
  const outcome = await runtime.dispatcher.dispatch({
    projectId,
    agent: dispatchAgentOf({
      agent,
      config: agent.config as ConnectedAgentConfig,
    }),
    call,
    signal,
  });
  return {
    output: outcome.output,
    ...(outcome.session !== undefined && { session: outcome.session }),
    instance: {
      hostname: outcome.instance.hostname,
      label: outcome.instance.label,
    },
    durationMs: outcome.durationMs,
  };
}

/** The connected agent the id names, or the refusal the caller reads. */
async function connectedAgentOf({
  deps,
  projectId,
  id,
}: {
  deps: AgentCallDeps;
  projectId: string;
  id: string;
}) {
  const agent = await deps.agents().getById({ id, projectId });
  if (!agent || agentTypeSchema.parse(agent.type) !== "connected") {
    throw new AgentNotFoundError("Connected agent not found");
  }
  return agent;
}

export function registerCallEndpoint({
  secured,
  deps,
}: {
  secured: SecuredApp<{ Variables: AppRestProjectVariables }>;
  deps: AgentCallDeps;
}): void {
  secured.access(requires("scenarios:create")).post(
    "/:id/call",
    describeRoute({
      operationId: "callConnectedAgent",
      tags: ["Agents"],
      description:
        "Send one conversation turn to a connected agent and get its answer. The agent must be online: a process running the decorated function must be connected.",
      responses: {
        200: {
          description: "The function's answer",
          content: {
            "application/json": { schema: resolver(relayCallResponseSchema) },
          },
        },
        404: {
          description: "No connected agent with that id in this project",
        },
        429: {
          description: "Every instance is busy; Retry-After says when to try again",
        },
        503: { description: "No instance of the agent is connected" },
      },
    }),
    bodyLimit({
      maxSize: relayPayloadCaps(deps.relayMaxPayloadMb).envelopeBytes,
      onError: () => {
        // The cap stopped the read, so no size was measured; the message
        // names the limit alone rather than a number nothing weighed.
        throw new AgentPayloadTooLargeError({
          what: "envelope",
          limitBytes: relayPayloadCaps(deps.relayMaxPayloadMb).envelopeBytes,
        });
      },
    }),
    zValidator("param", idParamsSchema),
    zValidator("json", relayCallBodySchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const project = c.get("project");
      const input = c.req.valid("json");

      const agent = await connectedAgentOf({ deps, projectId: project.id, id });
      await deps.assertRunnable({
        agent,
        apiKeyUserId: c.get("apiKeyUserId"),
      });

      const call = dispatchCallOf({
        body: input,
        traceparentHeader: c.req.header("traceparent") ?? null,
      });
      try {
        return c.json(
          await dispatchTurn({
            runtime: deps.runtime(),
            projectId: project.id,
            // `agent` is the full discriminated union `AgentApp.getById`
            // answers; `dispatchTurn` only ever reads these four fields, so
            // it declares the narrow contract view rather than the union.
            agent: {
              id: agent.id,
              name: agent.name,
              environment: agent.environment ?? null,
              config: agent.config,
            },
            call,
            signal: c.req.raw.signal,
          }),
        );
      } catch (error) {
        if (error instanceof AgentBusyError) {
          c.header("Retry-After", String(Math.ceil((error.meta.retryAfterMs as number) / 1000)));
        }
        throw error;
      }
    },
  );
}

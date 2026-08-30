/**
 * `POST /api/v1/agents/:id/call`: one turn to a connected agent, answered
 * with the function's output (ADR-128, "Transport").
 *
 * The scenario child calls it with the project key, and so do the Test
 * panel, `langwatch agent run` and MCP. The endpoint needs `scenarios:create`
 * and the agent's own project; it dispatches to a live instance and answers,
 * or refuses with one of the handled errors the contract names.
 */

import { z } from "zod";
import type { ConnectedComponentConfig } from "~/optimization_studio/types/dsl";
import { agentTypeSchema } from "~/server/agents/agent.repository";
import { AgentNotFoundError } from "~/server/agents/errors";
import type {
  DispatchAgent,
  DispatchCall,
} from "~/server/connected-agents/call.dispatcher";
import {
  DEFAULT_CALL_TIMEOUT_MS,
  MAX_CALL_TIMEOUT_MS,
  relayPayloadCaps,
} from "~/server/connected-agents/constants";
import {
  AgentBusyError,
  AgentPayloadTooLargeError,
} from "~/server/connected-agents/errors";
import {
  callRunSchema,
  messageSchema,
  outputSchema,
  paramsSchema,
} from "~/server/connected-agents/protocol";
import { getConnectedAgentRuntime } from "~/server/connected-agents/runtime";
import { prisma } from "~/server/db";
import { bodyLimit } from "~/server/routes/_lib/body-limit";
import { assertConnectedAgentsRunnable } from "~/server/suites/connected-targets";
import type { AgentsApp, AgentsGuard, AgentsVersion } from "./agents.v1";

export const relayCallBodySchema = z.object({
  messages: z
    .array(messageSchema)
    .describe("The whole conversation so far, OpenAI style."),
  newMessages: z
    .array(messageSchema)
    .optional()
    .describe(
      "The messages added since the agent's last turn. Defaults to the last message.",
    ),
  threadId: z
    .string()
    .max(255)
    .optional()
    .describe(
      "The conversation id. Turns of one conversation share it; a new id starts a new one.",
    ),
  params: paramsSchema
    .optional()
    .describe("Run parameter values by name, as JSON scalars."),
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
    .describe(
      "The W3C trace context the agent adopts, so its spans join this turn's trace.",
    ),
  run: callRunSchema
    .optional()
    .describe("The simulation run this turn belongs to, if any."),
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

/** The agent the dispatcher needs, with the per-call budget capped. */
function dispatchAgentOf({
  agent,
  config,
}: {
  agent: { id: string; name: string; environment: string | null };
  config: ConnectedComponentConfig;
}): DispatchAgent {
  return {
    id: agent.id,
    name: agent.name,
    environment: agent.environment,
    timeoutMs: Math.min(
      config.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS,
      MAX_CALL_TIMEOUT_MS,
    ),
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
  projectId,
  agent,
  call,
  signal,
}: {
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
  const outcome = await getConnectedAgentRuntime().dispatcher.dispatch({
    projectId,
    agent: dispatchAgentOf({
      agent,
      config: agent.config as ConnectedComponentConfig,
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

export function registerCallEndpoint({
  v,
  guard,
}: {
  v: AgentsVersion;
  guard: AgentsGuard;
}): void {
  v.post(
    "/:id/call",
    {
      ...guard("scenarios:create"),
      params: idParamsSchema,
      input: relayCallBodySchema,
      output: relayCallResponseSchema,
      middleware: [
        bodyLimit({
          maxSize: relayPayloadCaps().envelopeBytes,
          onError: () => {
            const caps = relayPayloadCaps();
            throw new AgentPayloadTooLargeError({
              what: "envelope",
              sizeBytes: caps.envelopeBytes + 1,
              limitBytes: caps.envelopeBytes,
            });
          },
        }),
      ],
      description:
        "Send one conversation turn to a connected agent and get its answer. The agent must be online: a process running the decorated function must be connected.",
      docs: {
        operationId: "callConnectedAgent",
        tags: ["Agents"],
        responses: {
          404: {
            description: "No connected agent with that id in this project",
          },
          429: {
            description:
              "Every instance is busy; Retry-After says when to try again",
            headers: {
              "Retry-After": {
                description:
                  "How many seconds to wait before the turn is sent again. Rounded up from the wait the platform picked.",
                schema: { type: "string" },
              },
            },
          },
          503: { description: "No instance of the agent is connected" },
        },
      },
    },
    async (
      c,
      {
        params,
        input,
        app,
      }: {
        params: { id: string };
        input: z.infer<typeof relayCallBodySchema>;
        app: AgentsApp;
      },
    ) => {
      const agent = await app.agents.getById({
        id: params.id,
        projectId: app.project.id,
      });
      if (!agent || agentTypeSchema.parse(agent.type) !== "connected") {
        throw new AgentNotFoundError("Connected agent not found");
      }

      // A development agent registered with a personal key belongs to one
      // person, so a personal key of someone else is refused. The project key
      // names no person and passes: the scenario child calls with it after the
      // owner gate ran when the run was scheduled.
      const apiKeyUserId = c.get("apiKeyUserId") as string | undefined;
      if (apiKeyUserId) {
        await assertConnectedAgentsRunnable({
          agents: [agent],
          actor: { id: apiKeyUserId, label: "api" },
          users: prisma,
        });
      }

      const call = dispatchCallOf({
        body: input,
        traceparentHeader: c.req.header("traceparent") ?? null,
      });
      try {
        return await dispatchTurn({
          projectId: app.project.id,
          agent,
          call,
          signal: c.req.raw.signal,
        });
      } catch (error) {
        if (error instanceof AgentBusyError) {
          c.header(
            "Retry-After",
            String(Math.ceil((error.meta.retryAfterMs as number) / 1000)),
          );
        }
        throw error;
      }
    },
  );
}

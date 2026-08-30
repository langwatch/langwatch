/**
 * The HTTP long-poll transport of connected agents, as three endpoints under
 * `/api/v1/agents/connect` (ADR-128, "Transport"): `POST /register`, `GET
 * /poll` and `POST /frames`. Same credentials as the socket: the API key as
 * a bearer token, plus `X-Project-Id` when the key reaches several projects.
 *
 * The endpoints authenticate inside the handler, through the same check the
 * socket runs, so a refusal is the same `refused` frame the SDK already
 * reads. A poll or a frame for a token the platform no longer knows answers
 * `agent_session_unknown` with status 410, and the SDK registers again.
 */

import type { Context } from "hono";
import { resolver } from "hono-openapi";
import { z } from "zod";
import { handlerManagedAuth } from "~/server/api/security";
import type { ProjectEndpointMeta } from "~/server/api/v1/project-service";
import {
  POLL_WAIT_MS,
  relayPayloadCaps,
} from "~/server/connected-agents/constants";
import {
  AgentPayloadTooLargeError,
  AgentRegisterRefusedError,
} from "~/server/connected-agents/errors";
import {
  INSTANCE_TOKEN_HEADER,
  type LongPollTransport,
} from "~/server/connected-agents/long-poll.transport";
import {
  ackFrameSchema,
  callFrameSchema,
  cancelFrameSchema,
  deregisterFrameSchema,
  refusedFrameSchema,
  registeredFrameSchema,
  registerFrameSchema,
  resultFrameSchema,
} from "~/server/connected-agents/protocol";
import type { ConnectCredentials } from "~/server/connected-agents/session.core";
import { bodyLimit } from "~/server/routes/_lib/body-limit";
import { requestBodySchema } from "~/server/routes/misc.schemas";
import type { AgentsVersion } from "./agents.v1";

/** The frames a process may post; a register goes to its own endpoint. */
export const postedFramesSchema = z.object({
  frames: z
    .array(z.union([ackFrameSchema, resultFrameSchema, deregisterFrameSchema]))
    .min(1)
    .max(100)
    .describe("Ack, result and deregister frames, in order."),
});

export const registerAnswerSchema = z.object({
  frame: z
    .union([registeredFrameSchema, refusedFrameSchema])
    .describe("The registered frame, or the refused frame with its reason."),
  instanceToken: z
    .string()
    .optional()
    .describe(
      "The token the poll and frames endpoints are addressed with, in the X-Agent-Instance-Token header. Present when the register was accepted.",
    ),
});

export const pollAnswerSchema = z.object({
  frames: z
    .array(z.union([callFrameSchema, cancelFrameSchema]))
    .describe(
      "The call and cancel frames waiting for the instance; empty once the poll wait passes with none.",
    ),
});

export const framesAnswerSchema = z.object({
  accepted: z.number().int().describe("How many frames were taken."),
});

const pollQuerySchema = z.object({
  inFlight: z
    .string()
    .max(200_000)
    .optional()
    .describe(
      "The call ids the process is still working on, comma separated. A cancel is answered for each one the platform no longer holds.",
    ),
});

/**
 * The access declaration of the three endpoints. The handler authenticates,
 * so the framework's auth is off and the policy registry reads why.
 */
const connectAccess = {
  auth: "none" as const,
  noPermission: {
    reason:
      "The handler authenticates the bearer key with the same check as the connect socket and answers refusals as protocol frames",
  },
  meta: {
    policy: handlerManagedAuth({
      reason:
        "The handler authenticates the bearer key with the same check as the connect socket and answers refusals as protocol frames",
      credential: "apiKey",
      permissions: ["scenarios:manage"],
    }),
  } satisfies ProjectEndpointMeta,
};

function credentialsOf(c: Context): ConnectCredentials {
  return {
    authorization: c.req.header("authorization"),
    projectId: c.req.header("x-project-id"),
  };
}

async function jsonBodyOf(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

/** A credential refusal is a refused frame; anything else stays an error. */
function refusedOrThrow(
  c: Context,
  error: unknown,
  transport: LongPollTransport,
): Response {
  if (error instanceof AgentRegisterRefusedError) {
    const answer = transport.refusedAnswer(error);
    return c.json(answer.body, answer.status as 200);
  }
  throw error;
}

const payloadGuard = () =>
  bodyLimit({
    maxSize: relayPayloadCaps().frameBytes,
    onError: () => {
      const caps = relayPayloadCaps();
      throw new AgentPayloadTooLargeError({
        what: "result",
        sizeBytes: caps.frameBytes + 1,
        limitBytes: caps.frameBytes,
      });
    },
  });

/** Registers the three endpoints over one transport; tests pass their own. */
export function registerConnectEndpoints({
  v,
  transport,
}: {
  v: AgentsVersion;
  transport: () => LongPollTransport;
}): void {
  v.post(
    "/connect/register",
    {
      ...connectAccess,
      middleware: [payloadGuard()],
      description:
        "Register the connected agents of a process over HTTP, for a network that blocks WebSockets. The body is the register frame of the connect protocol. Answers with the registered frame and the instance token the poll and frames endpoints are addressed with, or with a refused frame.",
      docs: {
        operationId: "registerConnectedAgentInstance",
        tags: ["Agents"],
        requestBody: {
          content: {
            "application/json": {
              schema: requestBodySchema(registerFrameSchema),
            },
          },
        },
        responses: {
          200: {
            description: "The instance is registered",
            content: {
              "application/json": { schema: resolver(registerAnswerSchema) },
            },
          },
          401: { description: "The API key is not valid: a refused frame" },
          403: {
            description:
              "The key type or its permissions cannot connect an agent: a refused frame",
          },
          422: {
            description:
              "The body is not a register frame, or an agent of it is not valid: a refused frame",
          },
          503: {
            description:
              "The deployment runs several replicas without Redis: a refused frame",
          },
        },
      },
    },
    async (c) => {
      const answer = await transport().register({
        credentials: credentialsOf(c),
        body: await jsonBodyOf(c),
      });
      return c.json(answer.body, answer.status as 200);
    },
  );

  v.get(
    "/connect/poll",
    {
      ...connectAccess,
      description: `Wait for the next call and cancel frames of a registered instance, up to ${POLL_WAIT_MS / 1000} seconds, then answer with what is waiting or with an empty list. Each poll refreshes the instance presence, so a process that polls reads Online. Addressed with the instance token in the X-Agent-Instance-Token header.`,
      docs: {
        operationId: "pollConnectedAgentInstance",
        tags: ["Agents"],
        responses: {
          200: {
            description: "The frames waiting for the instance, possibly none",
            content: {
              "application/json": { schema: resolver(pollAnswerSchema) },
            },
          },
          401: { description: "The API key is not valid: a refused frame" },
          410: {
            description:
              "The instance token is not known; register the instance again",
          },
        },
      },
    },
    async (c) => {
      const query = pollQuerySchema.safeParse({
        inFlight: c.req.query("inFlight"),
      });
      const inFlightCallIds = query.success
        ? (query.data.inFlight ?? "").split(",").filter(Boolean)
        : [];
      try {
        const answer = await transport().poll({
          credentials: credentialsOf(c),
          token: c.req.header(INSTANCE_TOKEN_HEADER),
          inFlightCallIds,
          signal: c.req.raw.signal,
        });
        return c.json(answer);
      } catch (error) {
        return refusedOrThrow(c, error, transport());
      }
    },
  );

  v.post(
    "/connect/frames",
    {
      ...connectAccess,
      middleware: [payloadGuard()],
      description:
        "Post the ack, result and deregister frames of a registered instance. Addressed with the instance token in the X-Agent-Instance-Token header.",
      docs: {
        operationId: "postConnectedAgentFrames",
        tags: ["Agents"],
        requestBody: {
          content: {
            "application/json": {
              schema: requestBodySchema(postedFramesSchema),
            },
          },
        },
        responses: {
          200: {
            description: "The frames were taken",
            content: {
              "application/json": { schema: resolver(framesAnswerSchema) },
            },
          },
          401: { description: "The API key is not valid: a refused frame" },
          410: {
            description:
              "The instance token is not known; register the instance again",
          },
          422: { description: "A frame is not one the endpoint takes" },
        },
      },
    },
    async (c) => {
      const parsed = postedFramesSchema.safeParse(await jsonBodyOf(c));
      if (!parsed.success) {
        throw new AgentRegisterRefusedError({
          reason: "protocol_invalid",
          message:
            "The body must carry ack, result and deregister frames under frames.",
        });
      }
      try {
        const answer = await transport().frames({
          credentials: credentialsOf(c),
          token: c.req.header(INSTANCE_TOKEN_HEADER),
          frames: parsed.data.frames,
        });
        return c.json(answer);
      } catch (error) {
        return refusedOrThrow(c, error, transport());
      }
    },
  );
}

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

import {
  ackFrameSchema,
  AgentPayloadTooLargeError,
  AgentRegisterRefusedError,
  callFrameSchema,
  cancelFrameSchema,
  deregisterFrameSchema,
  POLL_WAIT_MS,
  refusedFrameSchema,
  registeredFrameSchema,
  registerFrameSchema,
  relayPayloadCaps,
  resultFrameSchema,
} from "@langwatch/agent-contract";
import { handlerManagedAuth } from "@langwatch/api";
import { bodyLimit, type AppRestProjectVariables, type SecuredApp } from "@langwatch/api/rest";
import type { Context } from "hono";
import { describeRoute, type DescribeRouteOptions, resolver } from "hono-openapi";
import { z } from "zod";

import {
  INSTANCE_TOKEN_HEADER,
  type LongPollTransport,
} from "../../services/connected-agent-long-poll.service";
import type { ConnectCredentials } from "../../services/connected-agent-session.service";

/** The schema slot of a `describeRoute` request body, on hono-openapi's terms. */
type RequestBodySchema = NonNullable<
  Extract<
    NonNullable<DescribeRouteOptions["requestBody"]>,
    { content: unknown }
  >["content"][string]["schema"]
>;

/**
 * A zod schema as a `requestBody` schema object.
 *
 * `resolver()` is the normal way to put a zod schema into `describeRoute`, but
 * it only types against `responses`; hono-openapi wants a plain schema object
 * under `requestBody`. These two routes parse their body by hand (a refusal
 * has to become a protocol frame, not a validator error), so there is no
 * `zValidator` for the generator to read one off either.
 */
const requestBodySchema = (schema: z.ZodType): RequestBodySchema =>
  z.toJSONSchema(schema, { target: "openapi-3.0", reused: "inline" }) as RequestBodySchema;

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
const connectAccess = handlerManagedAuth({
  reason:
    "The handler authenticates the bearer key with the same check as the connect socket and answers refusals as protocol frames",
  credential: "apiKey",
  permissions: ["scenarios:manage"],
});

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
function refusedOrThrow(c: Context, error: unknown, transport: LongPollTransport): Response {
  if (error instanceof AgentRegisterRefusedError) {
    const answer = transport.refusedAnswer(error);
    return c.json(answer.body, answer.status as 200);
  }
  throw error;
}

const payloadGuard = (relayMaxPayloadMb: number | undefined) =>
  bodyLimit({
    maxSize: relayPayloadCaps(relayMaxPayloadMb).frameBytes,
    onError: () => {
      // The cap stopped the read, so no size was measured; the message names
      // the limit alone rather than a number nothing weighed.
      throw new AgentPayloadTooLargeError({
        what: "result",
        limitBytes: relayPayloadCaps(relayMaxPayloadMb).frameBytes,
      });
    },
  });

export interface ConnectEndpointDeps {
  secured: SecuredApp<{ Variables: AppRestProjectVariables }>;
  transport: () => LongPollTransport;
  /** `LANGWATCH_AGENT_RELAY_MAX_PAYLOAD_MB`; the default cap when absent. */
  relayMaxPayloadMb?: number;
}

/** The register endpoint: one process announces the agents it serves. */
function registerRegisterEndpoint({
  secured,
  transport,
  relayMaxPayloadMb,
}: ConnectEndpointDeps): void {
  secured.access(connectAccess).post(
    "/connect/register",
    describeRoute({
      operationId: "registerConnectedAgentInstance",
      tags: ["Agents"],
      description:
        "Register the connected agents of a process over HTTP, for a network that blocks WebSockets. The body is the register frame of the connect protocol. Answers with the registered frame and the instance token the poll and frames endpoints are addressed with, or with a refused frame.",
      requestBody: {
        content: {
          "application/json": { schema: requestBodySchema(registerFrameSchema) },
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
          description: "The key type or its permissions cannot connect an agent: a refused frame",
        },
        422: {
          description:
            "The body is not a register frame, or an agent of it is not valid: a refused frame",
        },
        503: {
          description: "The deployment runs several replicas without Redis: a refused frame",
        },
      },
    }),
    payloadGuard(relayMaxPayloadMb),
    async (c) => {
      const answer = await transport().register({
        credentials: credentialsOf(c),
        body: await jsonBodyOf(c),
      });
      return c.json(answer.body, answer.status as 200);
    },
  );
}

/** The poll endpoint: the instance waits for its next frames. */
function registerPollEndpoint({ secured, transport }: ConnectEndpointDeps): void {
  secured.access(connectAccess).get(
    "/connect/poll",
    describeRoute({
      operationId: "pollConnectedAgentInstance",
      tags: ["Agents"],
      description: `Wait for the next call and cancel frames of a registered instance, up to ${POLL_WAIT_MS / 1000} seconds, then answer with what is waiting or with an empty list. Each poll refreshes the instance presence, so a process that polls reads Online. Addressed with the instance token in the X-Agent-Instance-Token header.`,
      responses: {
        200: {
          description: "The frames waiting for the instance, possibly none",
          content: {
            "application/json": { schema: resolver(pollAnswerSchema) },
          },
        },
        401: { description: "The API key is not valid: a refused frame" },
        410: {
          description: "The instance token is not known; register the instance again",
        },
      },
    }),
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
}

/** The frames endpoint: the instance posts its answers back. */
function registerFramesEndpoint({
  secured,
  transport,
  relayMaxPayloadMb,
}: ConnectEndpointDeps): void {
  secured.access(connectAccess).post(
    "/connect/frames",
    describeRoute({
      operationId: "postConnectedAgentFrames",
      tags: ["Agents"],
      description:
        "Post the ack, result and deregister frames of a registered instance. Addressed with the instance token in the X-Agent-Instance-Token header.",
      requestBody: {
        content: {
          "application/json": { schema: requestBodySchema(postedFramesSchema) },
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
          description: "The instance token is not known; register the instance again",
        },
        422: { description: "A frame is not one the endpoint takes" },
      },
    }),
    payloadGuard(relayMaxPayloadMb),
    async (c) => {
      try {
        const parsed = postedFramesSchema.safeParse(await jsonBodyOf(c));
        if (!parsed.success) {
          throw new AgentRegisterRefusedError({
            reason: "protocol_invalid",
            message: "The body must carry ack, result and deregister frames under frames.",
          });
        }
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

/** Registers the three endpoints over one transport; tests pass their own. */
export function registerConnectEndpoints(deps: ConnectEndpointDeps): void {
  registerRegisterEndpoint(deps);
  registerPollEndpoint(deps);
  registerFramesEndpoint(deps);
}

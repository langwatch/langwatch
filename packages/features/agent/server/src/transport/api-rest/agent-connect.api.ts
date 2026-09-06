/**
 * The HTTP long-poll transport of connected agents, as three endpoints under /poll` and
 * `POST /frames`.
 * `/api/v1/agents/connect` (ADR-128, "Transport"): `POST /register`, `GET
 */

import {
  ackFrameSchema,
  AgentPayloadTooLargeError,
  AgentRegisterRefusedError,
  callFrameSchema,
  cancelFrameSchema,
  deregisterFrameSchema,
  INSTANCE_TOKEN_HEADER,
  POLL_WAIT_MS,
  refusedFrameSchema,
  registeredFrameSchema,
  relayPayloadCaps,
  resultFrameSchema,
} from "@langwatch/agent-contract";
import { handlerManagedAuth } from "@langwatch/api";
import {
  bodyLimit,
  type EndpointVariables,
  MANAGEMENT_API_VERSION,
  type ProjectScopedContext,
  type RestApiVersionedFamily,
  resolver,
} from "@langwatch/api/rest";
import { z } from "zod";

import type { LongPollTransportService } from "../../services/connected-agent-long-poll.service.ts";
import type { ConnectCredentials } from "../../services/connected-agent-session.service.ts";

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

/** The handler context the three endpoints run on. */
type ConnectContext = ProjectScopedContext<EndpointVariables>;

/**
 * The protocol answers a refusal as a FRAME carrying its own status — 401,
 * 403, 410, 422, 503 — so the endpoint has no single success status to
 * declare and writes the transport's answer through unchanged.
 */
const FRAME_ANSWER_REASON =
  "the connect protocol answers with a frame whose status is the frame's, not the endpoint's";

function credentialsOf(c: ConnectContext): ConnectCredentials {
  return {
    authorization: c.req.header("authorization"),
    projectId: c.req.header("x-project-id"),
  };
}

/** The posted bytes as JSON, or null when they are not JSON at all. */
function jsonBodyOf(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
}

/** A credential refusal is a refused frame; anything else stays an error. */
function refusedOrThrow(
  c: ConnectContext,
  error: unknown,
  transport: LongPollTransportService,
): Response {
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
  family: RestApiVersionedFamily;
  transport: () => LongPollTransportService;
  /** `LANGWATCH_AGENT_RELAY_MAX_PAYLOAD_MB`; the default cap when absent. */
  relayMaxPayloadMb?: number;
}

/** The register endpoint: one process announces the agents it serves. */
function registerRegisterEndpoint({
  family,
  transport,
  relayMaxPayloadMb,
}: ConnectEndpointDeps): void {
  const registerHandler = async (c: ConnectContext, input: { body: string }) => {
    const answer = await transport().register({
      credentials: credentialsOf(c),
      body: jsonBodyOf(input.body),
    });
    return c.json(answer.body, answer.status as 200);
  };

  family.service.registerRoute(
    "post",
    "/connect/register",
    MANAGEMENT_API_VERSION,
    registerHandler,
    (b) =>
      family
        .policy(connectAccess)(b)
        .withRawBody("text", { contentType: "application/json" })
        .withRawResponse(FRAME_ANSWER_REASON, { contentType: "application/json" })
        .withMiddleware(payloadGuard(relayMaxPayloadMb))
        .withDocs({
          operationId: "registerConnectedAgentInstance",
          tags: ["Agents"],
          description:
            "Register the connected agents of a process over HTTP, for a network that blocks WebSockets. The body is the register frame of the connect protocol. Answers with the registered frame and the instance token the poll and frames endpoints are addressed with, or with a refused frame.",
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
              description: "The deployment runs several replicas without Redis: a refused frame",
            },
          },
        }),
  );
}

/** The poll endpoint: the instance waits for its next frames. */
function registerPollEndpoint({ family, transport }: ConnectEndpointDeps): void {
  // The in-flight list is read rather than declared: a list too long to parse
  // has always been treated as none in flight, and declaring it would turn
  // that into a rejected request.
  const pollHandler = async (c: ConnectContext) => {
    const query = pollQuerySchema.safeParse({ inFlight: c.req.query("inFlight") });
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
  };

  family.service.registerRoute("get", "/connect/poll", MANAGEMENT_API_VERSION, pollHandler, (b) =>
    family
      .policy(connectAccess)(b)
      .withRawResponse(FRAME_ANSWER_REASON, { contentType: "application/json" })
      .withDocs({
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
  );
}

/** The frames endpoint: the instance posts its answers back. */
function registerFramesEndpoint({
  family,
  transport,
  relayMaxPayloadMb,
}: ConnectEndpointDeps): void {
  const framesHandler = async (c: ConnectContext, input: { body: string }) => {
    try {
      const parsed = postedFramesSchema.safeParse(jsonBodyOf(input.body));
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
  };

  family.service.registerRoute(
    "post",
    "/connect/frames",
    MANAGEMENT_API_VERSION,
    framesHandler,
    (b) =>
      family
        .policy(connectAccess)(b)
        .withRawBody("text", { contentType: "application/json" })
        .withRawResponse(FRAME_ANSWER_REASON, { contentType: "application/json" })
        .withMiddleware(payloadGuard(relayMaxPayloadMb))
        .withDocs({
          operationId: "postConnectedAgentFrames",
          tags: ["Agents"],
          description:
            "Post the ack, result and deregister frames of a registered instance. Addressed with the instance token in the X-Agent-Instance-Token header.",
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
  );
}

/** Registers the three endpoints over one transport; tests pass their own. */
export function registerConnectEndpoints(deps: ConnectEndpointDeps): void {
  registerRegisterEndpoint(deps);
  registerPollEndpoint(deps);
  registerFramesEndpoint(deps);
}

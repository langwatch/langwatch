/**
 * `/api/v1/agents/connect/*` - the connected-agent instance protocol: register,
 * poll for work, post results. The credential is not the project door's own:
 * a connecting instance presents its key and project explicitly over headers,
 * and the app verifies them itself. Routes are declared public so the
 * framework resolves no credential of its own; the protocol's own headers
 * arrive as a bound fact.
 *
 * A refusal is thrown as its own `HandledError` (`AgentRegisterRefusedError`),
 * never returned as a 200 body: each reason carries the HTTP status origin/main
 * answered it with, and `meta.frame` is the refused frame the SDK reads, which
 * the REST boundary spreads onto the flat error body.
 */
import {
  ackFrameSchema,
  AgentApi,
  AgentPayloadTooLargeError,
  AgentRegisterRefusedError,
  agentConnectCredentialsSchema,
  callFrameSchema,
  cancelFrameSchema,
  deregisterFrameSchema,
  registeredFrameSchema,
  relayPayloadCaps,
  resultFrameSchema,
} from "@langwatch/agent-contract";
import {
  defineRestMiddleware,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  type RestTransportDeclaration,
} from "@langwatch/api/rest";
import { z } from "zod";

/**
 * The protocol's own credential facts, bound from the request's own headers:
 * `authorization`, `x-project-id`, `x-agent-instance-token`. Not the family's
 * door - the app verifies these itself and answers a refusal as a frame.
 */
export const agentConnectHeaders = defineRestMiddleware(
  "agentConnectHeaders",
  agentConnectCredentialsSchema,
);

export const postedFramesSchema = z.object({
  frames: z
    .array(z.union([ackFrameSchema, resultFrameSchema, deregisterFrameSchema]))
    .min(1)
    .max(100)
    .describe("Ack, result and deregister frames, in order."),
});

export const registerAnswerSchema = z.object({
  frame: registeredFrameSchema.describe("The registered frame."),
  instanceToken: z
    .string()
    .optional()
    .describe(
      "The token the poll and frames endpoints are addressed with, in the X-Agent-Instance-Token header.",
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
  inFlight: z.string().max(200_000).optional().catch(void 0),
});

/** A body neither `JSON.parse` nor the register schema could make sense of. */
const invalidBodyRefusal = () =>
  new AgentRegisterRefusedError({
    reason: "protocol_invalid",
    message: "The request is not a valid connected-agent frame.",
  });

/**
 * Builds the `/api/v1/agents/connect` family. `relayMaxPayloadMb` is resolved
 * by the caller at mount time (`LANGWATCH_AGENT_RELAY_MAX_PAYLOAD_MB`); it
 * must never be read at module load, or every deployment gets the protocol
 * default regardless of its own configuration.
 */
export function createAgentConnectRest(
  relayMaxPayloadMb?: number,
): Readonly<{ protocol: "rest"; namespace: string; router: () => RestTransportDeclaration<AgentApi> }> {
  const relayCaps = relayPayloadCaps(relayMaxPayloadMb);

  return defineRestRouter(AgentApi)
    .withNamespace("agents")
    .withVersion(MANAGEMENT_API_VERSION)

    .post("/connect/register", "registerConnectedAgentInstance")
    .withRawBody("text")
    .withAccess({
      kind: "public",
      reason:
        "The connected-session protocol authenticates its declared credential facts and answers refusals as a HandledError carrying the refused frame.",
    })
    .withOutput(registerAnswerSchema)
    .withBodyLimit({
      maxBytes: relayCaps.frameBytes,
      onExceeded: () =>
        new AgentPayloadTooLargeError({ what: "result", limitBytes: relayCaps.frameBytes }),
    })
    .withDocs({
      summary: "Register this process's agents",
      description:
        "Returns a registered frame and instance token, or refuses at the status of the reason.",
    })
    .withMiddleware(agentConnectHeaders)
    .handle(async ({ app, raw }, credentials) => {
      let body: unknown;

      try {
        body = JSON.parse(raw as string);
      } catch {
        throw invalidBodyRefusal();
      }

      const answer = await app.connectRegister(body, credentials);
      // `connectRegister` answers a refusal rather than throwing it (the
      // socket transport reads the same shape); the REST endpoint re-raises
      // it here so the boundary answers at the reason's own HTTP status.
      if (answer.frame.type === "refused") {
        throw new AgentRegisterRefusedError({
          reason: answer.frame.code,
          message: answer.frame.message,
          meta: answer.frame.meta,
        });
      }

      return { frame: answer.frame, instanceToken: answer.instanceToken };
    })

    .get("/connect/poll", "pollConnectedAgentInstance")
    .withQuery(pollQuerySchema)
    .withAccess({
      kind: "public",
      reason:
        "The connected-session protocol authenticates its declared credential facts and answers refusals as a HandledError carrying the refused frame.",
    })
    .withOutput(pollAnswerSchema)
    .withDocs({ summary: "Wait for call and cancel frames while refreshing this instance's presence" })
    .withMiddleware(agentConnectHeaders)
    .handle(async ({ app, input, signal }, credentials) => {
      const inFlightCallIds = (input.inFlight ?? "").split(",").filter(Boolean);

      return app.connectPoll({ inFlightCallIds, signal }, credentials);
    })

    .post("/connect/frames", "postConnectedAgentFrames")
    .withRawBody("text")
    .withAccess({
      kind: "public",
      reason:
        "The connected-session protocol authenticates its declared credential facts and answers refusals as a HandledError carrying the refused frame.",
    })
    .withOutput(framesAnswerSchema)
    .withBodyLimit({
      maxBytes: relayCaps.frameBytes,
      onExceeded: () =>
        new AgentPayloadTooLargeError({ what: "result", limitBytes: relayCaps.frameBytes }),
    })
    .withDocs({ summary: "Accept this instance's acknowledgements, results and deregistration" })
    .withMiddleware(agentConnectHeaders)
    .handle(async ({ app, raw }, credentials) => {
      let body: unknown;

      try {
        body = JSON.parse(raw as string);
      } catch {
        throw invalidBodyRefusal();
      }

      // Parsed by hand, not `.withInput()`: a frame the endpoint does not
      // take is a protocol refusal carrying the refused frame, not the
      // framework's generic validation error.
      const parsed = postedFramesSchema.safeParse(body);
      if (!parsed.success) {
        throw new AgentRegisterRefusedError({
          reason: "protocol_invalid",
          message: "The body must carry ack, result and deregister frames under frames.",
        });
      }

      return app.connectFrames(parsed.data, credentials);
    })

    .build();
}

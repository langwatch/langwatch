/**
 * `/api/v1/agents/connect/*` - the connected-agent instance protocol: register,
 * poll for work, post results. The credential is not the project door's own:
 * a connecting instance presents its key and project explicitly over headers,
 * and the app verifies them itself, answering a refusal as a frame rather than
 * an HTTP error. Routes are declared public so the framework resolves no
 * credential of its own; the protocol's own headers arrive as a bound fact.
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
  refusedFrameSchema,
  registeredFrameSchema,
  relayPayloadCaps,
  resultFrameSchema,
  PROTOCOL_VERSION,
  type RefusedCode,
} from "@langwatch/agent-contract";
import { defineRestMiddleware, defineRestRouter, MANAGEMENT_API_VERSION } from "@langwatch/api/rest";
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
  inFlight: z.string().max(200_000).optional().catch(void 0),
});

const refusalSchema = z.object({ frame: refusedFrameSchema });

// A plain `z.union` is not a valid REST output schema (only ZodObject,
// ZodArray and ZodDiscriminatedUnion are), and these two shapes share no
// discriminator field, so a refusable answer merges both into one optional
// object instead of unioning two schemas.
const pollOrRefusalSchema = z.object({
  frames: pollAnswerSchema.shape.frames.optional(),
  frame: refusedFrameSchema.optional(),
});
const framesOrRefusalSchema = z.object({
  accepted: framesAnswerSchema.shape.accepted.optional(),
  frame: refusedFrameSchema.optional(),
});

/**
 * A refused frame, answered at HTTP 200: the declarative router ties status to
 * the declared output schema, and register/poll/frames declare one schema
 * covering both outcomes. origin/main answered a refusal at a code-specific
 * status (401/403/422/503); a client reading the frame body is unaffected, one
 * branching on HTTP status is not. See the agent module handover notes.
 */
function refusal(error: AgentRegisterRefusedError): z.infer<typeof refusalSchema> {
  const { reason, ...meta } = error.meta as { reason: RefusedCode } & Record<string, unknown>;

  return refusalSchema.parse({
    frame: {
      type: "refused",
      protocol: PROTOCOL_VERSION,
      code: reason,
      message: error.message,
      ...(Object.keys(meta).length ? { meta } : {}),
    },
  });
}

const relayCaps = relayPayloadCaps();

export const agentConnectRest = defineRestRouter(AgentApi)
  .withNamespace("agents")
  .withVersion(MANAGEMENT_API_VERSION)

  .post("/connect/register", "registerConnectedAgentInstance")
  .withRawBody("text")
  .withAccess({
    kind: "public",
    reason:
      "The connected-session protocol authenticates its declared credential facts and answers refusals as protocol frames.",
  })
  .withOutput(registerAnswerSchema)
  .withBodyLimit({
    maxBytes: relayCaps.frameBytes,
    onExceeded: () => new AgentPayloadTooLargeError({ what: "result", limitBytes: relayCaps.frameBytes }),
  })
  .withDocs({
    summary: "Register this process's agents",
    description:
      "Returns a registered frame and instance token, or a refused frame.",
  })
  .withMiddleware(agentConnectHeaders)
  .handle(async ({ app, raw }, credentials) => {
    let body: unknown;

    try {
      body = JSON.parse(raw as string);
    } catch {
      const error = new AgentRegisterRefusedError({
        reason: "protocol_invalid",
        message: "The request is not a valid connected-agent frame.",
      });

      return refusal(error) as z.infer<typeof registerAnswerSchema>;
    }

    try {
      return await app.connectRegister(body, credentials);
    } catch (error) {
      if (error instanceof AgentRegisterRefusedError) return refusal(error) as never;
      throw error;
    }
  })

  .get("/connect/poll", "pollConnectedAgentInstance")
  .withQuery(pollQuerySchema)
  .withAccess({
    kind: "public",
    reason:
      "The connected-session protocol authenticates its declared credential facts and answers refusals as protocol frames.",
  })
  .withOutput(pollOrRefusalSchema)
  .withDocs({ summary: "Wait for call and cancel frames while refreshing this instance's presence" })
  .withMiddleware(agentConnectHeaders)
  .handle(async ({ app, input, signal }, credentials) => {
    const inFlightCallIds = (input.inFlight ?? "").split(",").filter(Boolean);

    try {
      return await app.connectPoll({ inFlightCallIds, signal }, credentials);
    } catch (error) {
      if (error instanceof AgentRegisterRefusedError) return refusal(error) as never;
      throw error;
    }
  })

  .post("/connect/frames", "postConnectedAgentFrames")
  .withInput(postedFramesSchema)
  .withAccess({
    kind: "public",
    reason:
      "The connected-session protocol authenticates its declared credential facts and answers refusals as protocol frames.",
  })
  .withOutput(framesOrRefusalSchema)
  .withBodyLimit({
    maxBytes: relayCaps.frameBytes,
    onExceeded: () => new AgentPayloadTooLargeError({ what: "result", limitBytes: relayCaps.frameBytes }),
  })
  .withDocs({ summary: "Accept this instance's acknowledgements, results and deregistration" })
  .withMiddleware(agentConnectHeaders)
  .handle(async ({ app, input }, credentials) => {
    try {
      return await app.connectFrames(input, credentials);
    } catch (error) {
      if (error instanceof AgentRegisterRefusedError) return refusal(error) as never;
      throw error;
    }
  })

  .build();

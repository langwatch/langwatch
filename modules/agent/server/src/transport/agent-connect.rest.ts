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
import { handlerManagedAuth } from "@langwatch/api";
import {
  MANAGEMENT_API_VERSION,
  registerJsonProtocol,
  type RestApiVersionedFamily,
} from "@langwatch/api/rest";
import { z } from "zod";

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

const pollQuerySchema = z
  .object({
    inFlight: z
      .string()
      .max(200_000)
      .optional()
      .catch(void 0),
  })
  .transform(({ inFlight }) => ({ inFlightCallIds: (inFlight ?? "").split(",").filter(Boolean) }));

const connectAccess = handlerManagedAuth({
  reason:
    "The connected-session protocol authenticates its declared credential facts and answers refusals as protocol frames.",
  credential: "apiKey",
  permissions: ["scenarios:manage"],
});

const headers = {
  authorization: "authorization",
  projectId: "x-project-id",
  instanceToken: "x-agent-instance-token",
};

const refusalSchema = z.object({ frame: refusedFrameSchema });
const refusalStatuses = {
  api_key_invalid: 401,
  project_required: 400,
  permission_denied: 403,
  key_type_not_allowed: 403,
  replica_count_unsupported: 503,
  parameters_invalid: 422,
  environment_invalid: 422,
  protocol_invalid: 422,
} as const satisfies Record<RefusedCode, number>;

function refused(error: unknown): z.infer<typeof refusalSchema> {
  if (!(error instanceof AgentRegisterRefusedError)) throw error;
  const { reason, ...meta } = error.meta;

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

function statusOf(response: object) {
  const refusal = refusalSchema.safeParse(response);
  return refusal.success ? refusalStatuses[refusal.data.frame.code] : 200;
}

export function registerConnectEndpoints(options: {
  family: RestApiVersionedFamily;
  app: () => AgentApi;
  relayMaxPayloadMb?: number;
}): void {
  const caps = relayPayloadCaps(options.relayMaxPayloadMb);
  const common = {
    family: options.family,
    app: options.app,
    version: MANAGEMENT_API_VERSION,
    access: connectAccess,
    facts: agentConnectCredentialsSchema,
    headers,
    error: refused,
    status: statusOf,
    tags: ["Agents"],
    inputError: () =>
      new AgentRegisterRefusedError({
        reason: "protocol_invalid",
        message: "The request is not a valid connected-agent frame.",
      }),
  };
  const payload = {
    maxPayloadBytes: caps.frameBytes,
    payloadError: () =>
      new AgentPayloadTooLargeError({ what: "result", limitBytes: caps.frameBytes }),
  };

  registerJsonProtocol({
    ...common,
    ...payload,
    method: "post",
    path: "/connect/register",
    operation: "registerConnectedAgentInstance",
    description:
      "Register this process's agents. Returns a registered frame and instance token, or a refused frame.",
    input: z.unknown(),
    output: registerAnswerSchema,
    responses: {
      200: { description: "The instance is registered" },
      400: { description: "The key requires an explicit project: a refused frame" },
      401: { description: "The API key is not valid: a refused frame" },
      403: { description: "The key type or permissions cannot connect an agent: a refused frame" },
      422: { description: "The register frame or an agent is invalid: a refused frame" },
      503: { description: "The deployment runs several replicas without Redis: a refused frame" },
    },
    handle: ({ app, input }, credentials) => app.connectRegister(input, credentials),
  });

  registerJsonProtocol({
    ...common,
    method: "get",
    path: "/connect/poll",
    operation: "pollConnectedAgentInstance",
    description: "Wait for call and cancel frames while refreshing this instance's presence.",
    input: pollQuerySchema,
    output: z.union([pollAnswerSchema, refusalSchema]),
    responses: {
      200: { description: "The frames waiting for the instance, possibly none" },
      401: { description: "The API key is not valid: a refused frame" },
      410: { description: "The instance token is unknown; register the instance again" },
    },
    handle: ({ app, input, signal }, credentials) =>
      app.connectPoll({ ...input, signal }, credentials),
  });

  registerJsonProtocol({
    ...common,
    ...payload,
    method: "post",
    path: "/connect/frames",
    operation: "postConnectedAgentFrames",
    description: "Accept this instance's acknowledgements, results and deregistration.",
    input: postedFramesSchema,
    output: z.union([framesAnswerSchema, refusalSchema]),
    responses: {
      200: { description: "The frames were taken" },
      401: { description: "The API key is not valid: a refused frame" },
      410: { description: "The instance token is unknown; register the instance again" },
      422: { description: "A frame is not one the endpoint takes" },
    },
    handle: ({ app, input }, credentials) => app.connectFrames(input, credentials),
  });
}

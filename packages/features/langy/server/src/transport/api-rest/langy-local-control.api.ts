/**
 * The local control REST family, `/api/langy/control` (ADR-129). **request**
 * runs on the developer's own key, resolved to a user. **connect** carries
 * the minted session key, authenticated in-handler like the socket.
 */

import { handlerManagedAuth, requires } from "@langwatch/api";
import {
  MANAGEMENT_API_VERSION,
  projectOf,
  type AppRestSecurity,
  type EndpointVariables,
  type MountableRestApp,
  type ProjectScopedContext,
} from "@langwatch/api/rest";
import { INSTANCE_TOKEN_HEADER } from "@langwatch/agent-contract";
import {
  approveControlRequestBodySchema,
  approveControlRequestResponseSchema,
  cliFrameSchema,
  LangyLocalRequestInvalidError,
  listControlRequestsResponseSchema,
  LOCAL_CONTROL_PROTOCOL_VERSION,
  platformFrameSchema,
  refusedFrameSchema,
  registeredFrameSchema,
  registerFrameSchema,
} from "@langwatch/langy-contract";
import { z } from "zod";

import type { LocalControlRuntime } from "#adapters/langy-local-control-runtime.adapter";
import { ControlRequestService } from "#services/langy-local-control-request.service";
import { conversationUrl } from "#rules/langy-local-session-text.rules";
import type { LocalControlLongPoll } from "./langy-local-control-long-poll.api.ts";

/** Everything the control family reaches that Langy does not own. */
export type LangyLocalControlRestPorts = Readonly<{
  /** The SAME runtime the panel and the worker's door read. */
  runtime: () => LocalControlRuntime;
  /** This process's long-poll sessions. */
  longPoll: () => LocalControlLongPoll;
  /** This deployment's own origin, for the endpoint and the follow-along link. */
  baseHost: string | undefined;
}>;

const idParamsSchema = z.object({
  id: z.string().min(1).describe("The control request id."),
});

const cancelResultSchema = z.object({
  id: z.string().describe("The request that was cancelled."),
  cancelled: z.literal(true).describe("Always true once the request is gone."),
});

const registerAnswerSchema = z.object({
  frame: z
    .union([registeredFrameSchema, refusedFrameSchema])
    .describe("The registered frame, or the refused frame with its reason."),
  instanceToken: z
    .string()
    .optional()
    .describe(
      "The token the poll and frames endpoints are addressed with, in the " +
        "X-Agent-Instance-Token header. Present when the register was accepted.",
    ),
});

const pollAnswerSchema = z.object({
  frames: z
    .array(platformFrameSchema)
    .describe("The frames waiting for the folder; empty once the poll wait passes with none."),
});

const framesBodySchema = z.object({
  frames: z
    .array(cliFrameSchema)
    .min(1)
    .max(100)
    .describe("Ack, result, permission_required and deregister frames, in order."),
});

const framesAnswerSchema = z.object({
  accepted: z.number().int().describe("How many frames were taken."),
});

const pollQuerySchema = z.object({
  inFlight: z.string().optional().describe("Comma-separated call ids this folder still holds."),
});

/**
 * The access declaration of the connect endpoints. The handler authenticates
 * the minted session key, so the framework's auth is off and the policy
 * registry records why.
 */
const connectAuth = handlerManagedAuth({
  reason:
    "The handler authenticates the minted Langy session key with the same check as the control " +
    "socket and answers refusals as protocol frames",
  credential: "apiKey",
  permissions: ["langy:create"],
});

export function createLangyLocalControlRestApp(options: {
  security: AppRestSecurity;
  ports: LangyLocalControlRestPorts;
}): MountableRestApp {
  const { security, ports } = options;

  const { service, policy } = security.createProjectVersionedApp({
    name: "langy-control",
    basePath: "/api/langy/control",
    errorEnvelope: "canonical",
  });

  type ControlContext = ProjectScopedContext<EndpointVariables>;

  /**
   * The user behind the caller's key. A legacy project key holds no user and
   * refuses the same way an unknown request id does — the answer never
   * reveals which requests exist.
   */
  const requireUser = (c: ControlContext): string => {
    const userId = c.get("apiKeyUserId") as string | undefined;
    if (!userId) throw new LangyLocalRequestInvalidError();
    return userId;
  };

  const listHandler = async (c: ControlContext) => {
    const requests = await ports.runtime().requests.listOpen({
      projectId: projectOf(c).id,
      userId: requireUser(c),
    });
    return { requests: requests.map((request) => ControlRequestService.toWire(request)) };
  };

  const approveHandler = async (c: ControlContext, input: { id: string }) => {
    const project = projectOf(c);
    const approved = await ports.runtime().requests.approve({
      requestId: input.id,
      userId: requireUser(c),
      projectId: project.id,
    });
    return {
      sessionKey: approved.sessionKey,
      endpoint: (ports.baseHost ?? "").replace(/\/+$/, ""),
      conversation: {
        id: approved.request.conversationId,
        title: approved.request.conversationTitle,
        url: conversationUrl(approved.request.conversationId, ports.baseHost, project.slug),
      },
    };
  };

  const cancelHandler = async (c: ControlContext, input: { id: string }) => {
    await ports.runtime().requests.cancel({
      requestId: input.id,
      userId: requireUser(c),
      projectId: projectOf(c).id,
    });
    return { id: input.id, cancelled: true as const };
  };

  const registerHandler = async (c: ControlContext) => {
    const frame = registerFrameSchema.safeParse(await c.req.json().catch(() => null));
    if (!frame.success) {
      return c.json(
        {
          frame: {
            type: "refused" as const,
            protocol: LOCAL_CONTROL_PROTOCOL_VERSION,
            code: "protocol_invalid" as const,
            message: `The body must be a register frame with protocol ${LOCAL_CONTROL_PROTOCOL_VERSION}.`,
          },
        },
        422,
      );
    }
    const authorization = c.req.header("authorization");
    const projectId = c.req.header("x-project-id");
    const outcome = await ports.longPoll().register({
      ...(authorization ? { authorization } : {}),
      ...(projectId ? { projectId } : {}),
      frame: frame.data,
    });
    if (!outcome.ok) {
      return c.json(
        {
          frame: {
            type: "refused" as const,
            protocol: LOCAL_CONTROL_PROTOCOL_VERSION,
            code: outcome.code,
            message: outcome.message,
          },
        },
        403,
      );
    }
    return c.json({ frame: outcome.reply, instanceToken: outcome.token }, 200);
  };

  const pollHandler = async (c: ControlContext) => {
    const answer = await ports.longPoll().poll({
      token: c.req.header(INSTANCE_TOKEN_HEADER) ?? "",
      inFlightCallIds: (c.req.query("inFlight") ?? "").split(",").filter(Boolean),
      signal: c.req.raw.signal,
    });
    if (!answer.ok) return c.json({ frames: [] }, 410);
    return c.json({ frames: answer.frames }, 200);
  };

  const framesHandler = async (c: ControlContext) => {
    const body = framesBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ accepted: 0 }, 422);
    const answer = await ports.longPoll().frames({
      token: c.req.header(INSTANCE_TOKEN_HEADER) ?? "",
      frames: body.data.frames,
    });
    if (!answer.ok) return c.json({ accepted: 0 }, 410);
    return c.json({ accepted: body.data.frames.length }, 200);
  };

  const connectDoor = policy(connectAuth);

  // The static /connect paths go first: a `/:id` verb registered before them
  // would answer for the segment "connect".
  return service
    .registerRoute("post", "/connect/register", MANAGEMENT_API_VERSION, registerHandler, (b) =>
      connectDoor(b).withRawResponse(
        "the registered frame with its instance token, or the refused frame with its reason",
      ),
    )
    .registerRoute("get", "/connect/poll", MANAGEMENT_API_VERSION, pollHandler, (b) =>
      connectDoor(b)
        .withQuery(pollQuerySchema)
        .withRawResponse(
          "the frames waiting for the folder, or 410 when the instance token is not known",
        ),
    )
    .registerRoute("post", "/connect/frames", MANAGEMENT_API_VERSION, framesHandler, (b) =>
      connectDoor(b).withRawResponse(
        "how many frames were taken, or 410 when the instance token is not known",
      ),
    )
    .registerRoute("get", "/requests", MANAGEMENT_API_VERSION, listHandler, (b) =>
      policy(requires("langy:view"))(b)
        .withOutput(listControlRequestsResponseSchema)
        .withDocs({
          summary: "List Langy control requests",
          description:
            "List the open requests Langy made for a folder of mine in this project. Only the " +
            "person Langy asked ever sees a request, and each one expires fifteen minutes " +
            "after it was made.",
          operationId: "listLangyControlRequests",
          tags: ["Langy"],
        }),
    )
    .registerRoute("post", "/requests/:id/approve", MANAGEMENT_API_VERSION, approveHandler, (b) =>
      policy(requires("langy:create"))(b)
        .withParams(idParamsSchema)
        .withInput(approveControlRequestBodySchema)
        .withOutput(approveControlRequestResponseSchema)
        .withDocs({
          summary: "Approve a Langy control request",
          description:
            "Approve one request and share the current folder with the conversation that " +
            "asked. Answers with a Langy session key scoped to that conversation, which is " +
            "never shown again. A request is single use: a second approval is refused.",
          operationId: "approveLangyControlRequest",
          tags: ["Langy"],
        }),
    )
    .registerRoute("post", "/requests/:id/cancel", MANAGEMENT_API_VERSION, cancelHandler, (b) =>
      policy(requires("langy:create"))(b)
        .withParams(idParamsSchema)
        .withOutput(cancelResultSchema)
        .withDocs({
          summary: "Cancel a Langy control request",
          description:
            "Refuse one request from the terminal. The card in the chat reads that sharing " +
            "was cancelled, and Langy's next turn offers the choice again.",
          operationId: "cancelLangyControlRequest",
          tags: ["Langy"],
        }),
    )
    .build();
}

export type { RegisterAnswer };
type RegisterAnswer = z.infer<typeof registerAnswerSchema>;
type PollAnswer = z.infer<typeof pollAnswerSchema>;
type FramesAnswer = z.infer<typeof framesAnswerSchema>;
export type { PollAnswer, FramesAnswer };

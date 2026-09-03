/**
 * The local control REST family, `/api/v1/langy/control` (ADR-129).
 *
 * Two kinds of endpoint live here, and they carry different credentials on
 * purpose.
 *
 * The **request** endpoints are the developer's own: list the control requests
 * Langy opened for me, approve one, cancel one. They run on the API key the
 * command line is signed in with, and every one of them resolves the caller to
 * a user, because a control request belongs to a person. A key with no user
 * behind it can hold no requests, so it lists none and can approve none.
 *
 * The **connect** endpoints are the long-poll transport of the control socket,
 * for a network that blocks WebSockets. They carry the minted session key, not
 * the developer's key, and they authenticate inside the handler with the same
 * check the socket runs, so a refusal is the same `refused` frame the command
 * line already reads. The WebSocket upgrade at `GET /connect` is served by the
 * gateway on the same listener, not by this app.
 */

import type { BaseApp, VersionBuilder } from "@langwatch/api";
import type { Context } from "hono";
import { resolver } from "hono-openapi";
import { z } from "zod";
import { env } from "~/env.mjs";
import type { Project } from "~/generated/prisma/client";
import { handlerManagedAuth } from "~/server/api/security";
import {
  createProjectService,
  type ProjectEndpointMeta,
} from "~/server/api/v1/project-service";
import { V1_API_VERSION } from "~/server/api/v1/version";
import { INSTANCE_TOKEN_HEADER } from "~/server/connected-agents/long-poll.transport";
import { toControlRequestWire } from "~/server/langy-local-control/control-request.service";
import { LangyLocalRequestInvalidError } from "~/server/langy-local-control/errors";
import {
  approveControlRequestBodySchema,
  approveControlRequestResponseSchema,
  listControlRequestsResponseSchema,
} from "~/server/langy-local-control/http";
import {
  cliFrameSchema,
  LOCAL_CONTROL_PROTOCOL_VERSION,
  platformFrameSchema,
  refusedFrameSchema,
  registeredFrameSchema,
  registerFrameSchema,
} from "~/server/langy-local-control/protocol";
import {
  getLocalControlLongPoll,
  getLocalControlRuntime,
} from "~/server/langy-local-control/runtime";
import { conversationUrl } from "~/server/langy-local-control/session.core";
import { requestBodySchema } from "~/server/routes/misc.schemas";

const { service, guard } = createProjectService({
  name: "langy-control",
  basePath: "/api/v1/langy/control",
});

type ControlApp = BaseApp<Project>;
type ControlVersion = VersionBuilder<ControlApp>;

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
      "The token the poll and frames endpoints are addressed with, in the X-Agent-Instance-Token header. Present when the register was accepted.",
    ),
});

const pollAnswerSchema = z.object({
  frames: z
    .array(platformFrameSchema)
    .describe(
      "The frames waiting for the folder; empty once the poll wait passes with none.",
    ),
});

const framesBodySchema = z.object({
  frames: z
    .array(cliFrameSchema)
    .min(1)
    .max(100)
    .describe(
      "Ack, result, permission_required and deregister frames, in order.",
    ),
});

const framesAnswerSchema = z.object({
  accepted: z.number().int().describe("How many frames were taken."),
});

/**
 * The access declaration of the connect endpoints. The handler authenticates
 * the minted session key, so the framework's auth is off and the policy
 * registry records why.
 */
const connectAccess = {
  auth: "none" as const,
  noPermission: {
    reason:
      "The handler authenticates the minted Langy session key with the same check as the control socket and answers refusals as protocol frames",
  },
  meta: {
    policy: handlerManagedAuth({
      reason:
        "The handler authenticates the minted Langy session key with the same check as the control socket and answers refusals as protocol frames",
      credential: "apiKey",
      permissions: ["langy:create"],
    }),
  } satisfies ProjectEndpointMeta,
};

/**
 * The user behind the caller's key.
 *
 * A control request belongs to a person, so a credential with no person behind
 * it holds none. A legacy project key is exactly that case, and it refuses the
 * same way an unknown request id does, so the answer never tells a caller
 * which requests exist.
 */
function requireUser(c: Context): string {
  const userId = c.get("apiKeyUserId") as string | undefined;
  if (!userId) throw new LangyLocalRequestInvalidError();
  return userId;
}

function registerRequestEndpoints(v: ControlVersion): void {
  v.get(
    "/requests",
    {
      ...guard("langy:view"),
      output: listControlRequestsResponseSchema,
      description:
        "List the open requests Langy made for a folder of mine in this project. Only the person Langy asked ever sees a request, and each one expires fifteen minutes after it was made.",
      docs: { operationId: "listLangyControlRequests", tags: ["Langy"] },
    },
    async (c, { app }: { app: ControlApp }) => {
      const requests = await getLocalControlRuntime().requests.listOpen({
        projectId: app.project.id,
        userId: requireUser(c),
      });
      return { requests: requests.map(toControlRequestWire) };
    },
  );

  v.post(
    "/requests/:id/approve",
    {
      ...guard("langy:create"),
      params: idParamsSchema,
      input: approveControlRequestBodySchema,
      output: approveControlRequestResponseSchema,
      description:
        "Approve one request and share the current folder with the conversation that asked. Answers with a Langy session key scoped to that conversation, which is never shown again. A request is single use: a second approval is refused.",
      docs: { operationId: "approveLangyControlRequest", tags: ["Langy"] },
    },
    async (c, { params, app }: { params: { id: string }; app: ControlApp }) => {
      const approved = await getLocalControlRuntime().requests.approve({
        requestId: params.id,
        userId: requireUser(c),
        projectId: app.project.id,
      });
      return {
        sessionKey: approved.sessionKey,
        endpoint: (env.BASE_HOST ?? "").replace(/\/+$/, ""),
        conversation: {
          id: approved.request.conversationId,
          title: approved.request.conversationTitle,
          url: conversationUrl(approved.request.conversationId),
        },
      };
    },
  );

  v.post(
    "/requests/:id/cancel",
    {
      ...guard("langy:create"),
      params: idParamsSchema,
      output: cancelResultSchema,
      description:
        "Refuse one request from the terminal. The card in the chat reads that sharing was cancelled, and Langy's next turn offers the choice again.",
      docs: { operationId: "cancelLangyControlRequest", tags: ["Langy"] },
    },
    async (c, { params, app }: { params: { id: string }; app: ControlApp }) => {
      await getLocalControlRuntime().requests.cancel({
        requestId: params.id,
        userId: requireUser(c),
        projectId: app.project.id,
      });
      return { id: params.id, cancelled: true as const };
    },
  );
}

/** The register that opens a long-poll share and hands back its token. */
function registerLongPollRegister(v: ControlVersion): void {
  v.post(
    "/connect/register",
    {
      ...connectAccess,
      description:
        "Share a folder over HTTP, for a network that blocks WebSockets. The body is the register frame of the control protocol. Answers with the registered frame and the instance token the poll and frames endpoints are addressed with, or with a refused frame.",
      docs: {
        operationId: "registerLangyControlSession",
        tags: ["Langy"],
        requestBody: {
          content: {
            "application/json": {
              schema: requestBodySchema(registerFrameSchema),
            },
          },
        },
        responses: {
          200: {
            description: "The folder is shared",
            content: {
              "application/json": { schema: resolver(registerAnswerSchema) },
            },
          },
          401: { description: "The session key is not valid: a refused frame" },
          403: {
            description:
              "The key is not a Langy session key, or it controls no conversation: a refused frame",
          },
          422: { description: "The body is not a register frame" },
        },
      },
    },
    async (c) => {
      const frame = registerFrameSchema.safeParse(
        await c.req.json().catch(() => null),
      );
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
      const outcome = await getLocalControlLongPoll().register({
        ...(c.req.header("authorization")
          ? { authorization: c.req.header("authorization") as string }
          : {}),
        ...(c.req.header("x-project-id")
          ? { projectId: c.req.header("x-project-id") as string }
          : {}),
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
      return c.json(
        { frame: outcome.reply, instanceToken: outcome.token },
        200,
      );
    },
  );
}

/** The wait that carries the platform's frames to a shared folder. */
function registerLongPollPoll(v: ControlVersion): void {
  v.get(
    "/connect/poll",
    {
      ...connectAccess,
      description:
        "Wait for the next frames of a shared folder, then answer with what is waiting or with an empty list. Each poll is also the folder's heartbeat, so a command line that polls reads connected. Addressed with the instance token in the X-Agent-Instance-Token header.",
      docs: {
        operationId: "pollLangyControlSession",
        tags: ["Langy"],
        responses: {
          200: {
            description: "The frames waiting for the folder, possibly none",
            content: {
              "application/json": { schema: resolver(pollAnswerSchema) },
            },
          },
          410: {
            description:
              "The instance token is not known; share the folder again",
          },
        },
      },
    },
    async (c) => {
      const answer = await getLocalControlLongPoll().poll({
        token: c.req.header(INSTANCE_TOKEN_HEADER) ?? "",
        inFlightCallIds: (c.req.query("inFlight") ?? "")
          .split(",")
          .filter(Boolean),
        signal: c.req.raw.signal,
      });
      if (!answer.ok) return c.json({ frames: [] }, 410);
      return c.json({ frames: answer.frames }, 200);
    },
  );
}

/** The post that carries the command line's own frames back. */
function registerLongPollFrames(v: ControlVersion): void {
  v.post(
    "/connect/frames",
    {
      ...connectAccess,
      description:
        "Post the frames the command line has for the platform: the acknowledgement of a call, its result, a permission the developer has to answer first, and the deregister that ends the share.",
      docs: {
        operationId: "postLangyControlFrames",
        tags: ["Langy"],
        requestBody: {
          content: {
            "application/json": {
              schema: requestBodySchema(framesBodySchema),
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
          410: {
            description:
              "The instance token is not known; share the folder again",
          },
          422: { description: "The body is not a list of frames" },
        },
      },
    },
    async (c) => {
      const body = framesBodySchema.safeParse(
        await c.req.json().catch(() => null),
      );
      if (!body.success) return c.json({ accepted: 0 }, 422);
      const answer = await getLocalControlLongPoll().frames({
        token: c.req.header(INSTANCE_TOKEN_HEADER) ?? "",
        frames: body.data.frames,
      });
      if (!answer.ok) return c.json({ accepted: 0 }, 410);
      return c.json({ accepted: body.data.frames.length }, 200);
    },
  );
}

/** The whole long-poll transport, for a network that blocks WebSockets. */
function registerConnectEndpoints(v: ControlVersion): void {
  registerLongPollRegister(v);
  registerLongPollPoll(v);
  registerLongPollFrames(v);
}

export const app = service
  .version(V1_API_VERSION, (v) => {
    // The static /connect paths go first: a `/:id` verb registered before them
    // would answer for the segment "connect".
    registerConnectEndpoints(v);
    registerRequestEndpoints(v);
  })
  .build();

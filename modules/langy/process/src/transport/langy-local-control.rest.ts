/**
 * The local control REST family, `/api/langy/control` (ADR-129). **request**
 * runs on the developer's own key, resolved to a user. **connect** carries
 * the minted session key, authenticated in-handler like the socket.
 */

import { INSTANCE_TOKEN_HEADER } from "@langwatch/agent-contract";
import {
  defineRestMiddleware,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  projectCredentialOfRequest,
} from "@langwatch/api/rest";
import type { AuthzApi } from "@langwatch/authz-contract";
import {
  approveControlRequestBodySchema,
  approveControlRequestResponseSchema,
  LangyApi,
  LangyLocalRequestInvalidError,
  listControlRequestsResponseSchema,
  LOCAL_CONTROL_PROTOCOL_VERSION,
  registerFrameSchema,
  langyControlIdParamsSchema,
  langyControlCancelResultSchema,
  langyControlFramesBodySchema,
  langyControlPollQuerySchema,
} from "@langwatch/langy-contract";
import { z } from "zod";

import type { LocalControlRuntime } from "#repositories/redis/redis.langy-local-control-runtime.repository";
import { conversationUrl } from "#rules/langy-local-session-text.rules";
import { ControlRequestAccessService } from "#services/langy-local-control-access.service";
import { ControlRequestService } from "#services/langy-local-control-request.service";

import type { LocalControlLongPoll } from "./langy-local-control-long-poll.rest.ts";

/** Everything the control family reaches that Langy does not own. */
export type LangyLocalControlRestMembers = Readonly<{
  /** The SAME runtime the panel and the worker's door read. */
  runtime: () => LocalControlRuntime;
  /** This process's long-poll sessions. */
  longPoll: () => LocalControlLongPoll;
  /** This deployment's own origin, for the endpoint and the follow-along link. */
  baseHost: string | undefined;
  /** Decides a permission on the request's own project, not the login's. */
  permissions: () => Pick<AuthzApi, "getDecision">;
}>;

/** What the process supplies this family beyond `LangyApi` and its own door. */
export const langyLocalControlRestMembers = defineRestMiddleware(
  "langyLocalControlRestMembers",
  z.custom<LangyLocalControlRestMembers>(),
);

/**
 * The user behind the caller's key. A legacy project key holds no user and
 * refuses the same way an unknown request id does — the answer never
 * reveals which requests exist.
 */
function controlUser(request: Request): string {
  const resolved = projectCredentialOfRequest(request);
  const userId = resolved.type === "apiKey" ? resolved.userId : null;
  if (!userId) throw new LangyLocalRequestInvalidError();
  return userId;
}

/** The person's reach over their requests, decided on each request's own project. */
function accessOf(members: LangyLocalControlRestMembers): ControlRequestAccessService {
  return ControlRequestAccessService.create({
    requests: members.runtime().requests,
    permissions: members.permissions(),
  });
}

export const langyLocalControlRest = defineRestRouter(LangyApi)
  .withNamespace("langy")
  .withVersion(MANAGEMENT_API_VERSION)
  .withCredential("project")
  .withAddressing("literal", { v1Twin: false })

  // The static /connect paths go first: a `/:id` verb registered before them
  // would answer for the segment "connect". Not this framework's concern
  // (paths are literal here), kept for readability parity with the routes
  // below.

  // ── connect: the folder authenticates its own minted session key ──────────

  .post("/api/langy/control/connect/register", "langyControlConnectRegister")
  .withAccess({
    kind: "public",
    reason:
      "the handler authenticates the minted Langy session key with the same check as the " +
      "control socket and answers refusals as protocol frames",
  })
  .withRawBody("text")
  .withRawResponse({ produces: "application/json" })
  .withDocs({
    description:
      "The registered frame with its instance token, or the refused frame with its reason.",
  })
  .withMiddleware(langyLocalControlRestMembers)
  .handle(async ({ raw, request }, members) => {
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      body = null;
    }
    const frame = registerFrameSchema.safeParse(body);
    if (!frame.success) {
      return Response.json(
        {
          frame: {
            type: "refused" as const,
            protocol: LOCAL_CONTROL_PROTOCOL_VERSION,
            code: "protocol_invalid" as const,
            message: `The body must be a register frame with protocol ${LOCAL_CONTROL_PROTOCOL_VERSION}.`,
          },
        },
        { status: 422 },
      );
    }
    const authorization = request.headers.get("authorization");
    const projectId = request.headers.get("x-project-id");
    const outcome = await members.longPoll().register({
      ...(authorization ? { authorization } : {}),
      ...(projectId ? { projectId } : {}),
      frame: frame.data,
    });
    if (!outcome.ok) {
      return Response.json(
        {
          frame: {
            type: "refused" as const,
            protocol: LOCAL_CONTROL_PROTOCOL_VERSION,
            code: outcome.code,
            message: outcome.message,
          },
        },
        { status: 403 },
      );
    }
    return Response.json({ frame: outcome.reply, instanceToken: outcome.token }, { status: 200 });
  })

  .get("/api/langy/control/connect/poll", "langyControlConnectPoll")
  .withAccess({
    kind: "public",
    reason:
      "the handler authenticates the minted Langy session key with the same check as the " +
      "control socket and answers refusals as protocol frames",
  })
  .withQuery(langyControlPollQuerySchema)
  .withRawResponse({ produces: "application/json" })
  .withDocs({
    description: "The frames waiting for the folder, or 410 when the instance token is not known.",
  })
  .withMiddleware(langyLocalControlRestMembers)
  .handle(async ({ input, request, signal }, members) => {
    const answer = await members.longPoll().poll({
      token: request.headers.get(INSTANCE_TOKEN_HEADER) ?? "",
      inFlightCallIds: (input.inFlight ?? "").split(",").filter(Boolean),
      signal,
    });
    if (!answer.ok) return Response.json({ frames: [] }, { status: 410 });
    return Response.json({ frames: answer.frames }, { status: 200 });
  })

  .post("/api/langy/control/connect/frames", "langyControlConnectFrames")
  .withAccess({
    kind: "public",
    reason:
      "the handler authenticates the minted Langy session key with the same check as the " +
      "control socket and answers refusals as protocol frames",
  })
  .withRawBody("text")
  .withRawResponse({ produces: "application/json" })
  .withDocs({
    description: "How many frames were taken, or 410 when the instance token is not known.",
  })
  .withMiddleware(langyLocalControlRestMembers)
  .handle(async ({ raw, request }, members) => {
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(raw);
    } catch {
      parsedBody = null;
    }
    const body = langyControlFramesBodySchema.safeParse(parsedBody);
    if (!body.success) return Response.json({ accepted: 0 }, { status: 422 });
    const answer = await members.longPoll().frames({
      token: request.headers.get(INSTANCE_TOKEN_HEADER) ?? "",
      frames: body.data.frames,
    });
    if (!answer.ok) return Response.json({ accepted: 0 }, { status: 410 });
    return Response.json({ accepted: body.data.frames.length }, { status: 200 });
  })

  // ── requests: the developer's own key, resolved to a user ─────────────────

  .get("/api/langy/control/requests", "listLangyControlRequests")
  .withPermission("langy:view")
  .withRawResponse({ produces: "application/json" })
  .withDocs({
    description:
      "List the open requests Langy made for a folder of mine, on every project I can read. Only the " +
      "person Langy asked ever sees a request, and each one expires fifteen minutes after " +
      "it was made.",
  })
  .withMiddleware(langyLocalControlRestMembers)
  .handle(async ({ request }, members) => {
    const requests = await accessOf(members).listReadable({ userId: controlUser(request) });
    return Response.json(
      listControlRequestsResponseSchema.parse({
        requests: requests.map((r) => ControlRequestService.toWire(r)),
      }),
      { status: 200 },
    );
  })

  .post("/api/langy/control/requests/:requestId/approve", "approveLangyControlRequest")
  .withPermission("langy:create")
  .withParams(langyControlIdParamsSchema)
  .withInput(approveControlRequestBodySchema)
  .withRawResponse({ produces: "application/json" })
  .withDocs({
    description:
      "Approve one request and share the current folder with the conversation that asked. " +
      "Answers with a Langy session key scoped to that conversation, which is never shown " +
      "again. A request is single use: a second approval is refused.",
  })
  .withMiddleware(langyLocalControlRestMembers)
  .handle(async ({ input, request }, members) => {
    const userId = controlUser(request);
    const addressed = await accessOf(members).getAddressed({
      requestId: input.requestId,
      userId,
      permission: "langy:create",
    });
    const approved = await members.runtime().requests.approve({
      requestId: addressed.id,
      userId,
    });
    return Response.json(
      approveControlRequestResponseSchema.parse({
        sessionKey: approved.sessionKey,
        endpoint: (members.baseHost ?? "").replace(/\/+$/, ""),
        conversation: {
          id: approved.request.conversationId,
          title: approved.request.conversationTitle,
          url: conversationUrl(
            approved.request.conversationId,
            members.baseHost,
            approved.projectSlug,
          ),
        },
      }),
      { status: 200 },
    );
  })

  .post("/api/langy/control/requests/:requestId/cancel", "cancelLangyControlRequest")
  .withPermission("langy:create")
  .withParams(langyControlIdParamsSchema)
  .withRawResponse({ produces: "application/json" })
  .withDocs({
    description:
      "Refuse one request from the terminal. The card in the chat reads that sharing was " +
      "cancelled, and Langy's next turn offers the choice again.",
  })
  .withMiddleware(langyLocalControlRestMembers)
  .handle(async ({ input, request }, members) => {
    const userId = controlUser(request);
    const addressed = await accessOf(members).getAddressed({
      requestId: input.requestId,
      userId,
      permission: "langy:create",
    });
    await members.runtime().requests.cancel({ requestId: addressed.id, userId });
    return Response.json(
      langyControlCancelResultSchema.parse({ id: input.requestId, cancelled: true }),
      {
        status: 200,
      },
    );
  })

  .build();

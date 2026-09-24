/**
 * The local folder's long-poll fallback, `/api/v1/langy/control/connect` (ADR-129). It carries
 * the minted session key, authenticated in-handler like the socket, and answers its refusals as
 * protocol frames (the connect bodies are wire).
 */

import { INSTANCE_TOKEN_HEADER } from "@langwatch/agent-contract";
import {
  defineRestMiddleware,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
} from "@langwatch/api/rest";
import {
  LangyApi,
  LOCAL_CONTROL_PROTOCOL_VERSION,
  registerFrameSchema,
  langyControlFramesBodySchema,
  langyControlPollQuerySchema,
} from "@langwatch/langy-contract";
import { z } from "zod";

import type { LocalControlLongPoll } from "./langy-local-control-long-poll.rest.ts";

/** Everything the connect routes reach that Langy does not own. */
export type LangyLocalControlConnectMembers = Readonly<{
  /** This process's long-poll sessions. */
  longPoll: () => LocalControlLongPoll;
}>;

/** What the process supplies the connect routes beyond `LangyApi`. */
export const langyLocalControlConnectMembers = defineRestMiddleware(
  "langyLocalControlConnectMembers",
  z.custom<LangyLocalControlConnectMembers>(),
);

/** The folder's own frame wire. */
const CONTROL_ANSWER = {
  produces: "application/json",
  because: "The local folder reads its refusals as protocol frames.",
} as const;

export const langyLocalControlConnectRest = defineRestRouter(LangyApi)
  .withNamespace("langy")
  .withVersion(MANAGEMENT_API_VERSION)
  .withCredential("project")
  .withAddressing("literal", { v1Twin: true })

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
  .withResponse("protocol", CONTROL_ANSWER)
  .withDocs({
    description:
      "The registered frame with its instance token, or the refused frame with its reason.",
  })
  .withMiddleware(langyLocalControlConnectMembers)
  .handle(async ({ raw, request, response }, members) => {
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      body = null;
    }
    const frame = registerFrameSchema.safeParse(body);
    if (!frame.success) {
      return response.write({
        status: 422,
        mediaType: "application/json",
        body: JSON.stringify({
          frame: {
            type: "refused" as const,
            protocol: LOCAL_CONTROL_PROTOCOL_VERSION,
            code: "protocol_invalid" as const,
            message: `The body must be a register frame with protocol ${LOCAL_CONTROL_PROTOCOL_VERSION}.`,
          },
        }),
      });
    }
    const authorization = request.headers.get("authorization");
    const projectId = request.headers.get("x-project-id");
    const outcome = await members.longPoll().register({
      ...(authorization ? { authorization } : {}),
      ...(projectId ? { projectId } : {}),
      frame: frame.data,
    });
    if (!outcome.ok) {
      return response.write({
        status: 403,
        mediaType: "application/json",
        body: JSON.stringify({
          frame: {
            type: "refused" as const,
            protocol: LOCAL_CONTROL_PROTOCOL_VERSION,
            code: outcome.code,
            message: outcome.message,
          },
        }),
      });
    }
    return response.write({
      status: 200,
      mediaType: "application/json",
      body: JSON.stringify({ frame: outcome.reply, instanceToken: outcome.token }),
    });
  })

  .get("/api/langy/control/connect/poll", "langyControlConnectPoll")
  .withAccess({
    kind: "public",
    reason:
      "the handler authenticates the minted Langy session key with the same check as the " +
      "control socket and answers refusals as protocol frames",
  })
  .withQuery(langyControlPollQuerySchema)
  .withResponse("protocol", CONTROL_ANSWER)
  .withDocs({
    description: "The frames waiting for the folder, or 410 when the instance token is not known.",
  })
  .withMiddleware(langyLocalControlConnectMembers)
  .handle(async ({ input, request, signal, response }, members) => {
    const answer = await members.longPoll().poll({
      token: request.headers.get(INSTANCE_TOKEN_HEADER) ?? "",
      inFlightCallIds: (input.inFlight ?? "").split(",").filter(Boolean),
      signal,
    });
    if (!answer.ok) {
      return response.write({
        status: 410,
        mediaType: "application/json",
        body: JSON.stringify({ frames: [] }),
      });
    }
    return response.write({
      status: 200,
      mediaType: "application/json",
      body: JSON.stringify({ frames: answer.frames }),
    });
  })

  .post("/api/langy/control/connect/frames", "langyControlConnectFrames")
  .withAccess({
    kind: "public",
    reason:
      "the handler authenticates the minted Langy session key with the same check as the " +
      "control socket and answers refusals as protocol frames",
  })
  .withRawBody("text")
  .withResponse("protocol", CONTROL_ANSWER)
  .withDocs({
    description: "How many frames were taken, or 410 when the instance token is not known.",
  })
  .withMiddleware(langyLocalControlConnectMembers)
  .handle(async ({ raw, request, response }, members) => {
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(raw);
    } catch {
      parsedBody = null;
    }
    const body = langyControlFramesBodySchema.safeParse(parsedBody);
    if (!body.success) {
      return response.write({
        status: 422,
        mediaType: "application/json",
        body: JSON.stringify({ accepted: 0 }),
      });
    }
    const answer = await members.longPoll().frames({
      token: request.headers.get(INSTANCE_TOKEN_HEADER) ?? "",
      frames: body.data.frames,
    });
    if (!answer.ok) {
      return response.write({
        status: 410,
        mediaType: "application/json",
        body: JSON.stringify({ accepted: 0 }),
      });
    }
    return response.write({
      status: 200,
      mediaType: "application/json",
      body: JSON.stringify({ accepted: body.data.frames.length }),
    });
  })

  .build();

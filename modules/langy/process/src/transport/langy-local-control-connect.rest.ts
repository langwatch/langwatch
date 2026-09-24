/**
 * The local folder's long-poll fallback, `/api/v1/langy/control/connect` (ADR-129). Register
 * authenticates the minted session key at its own door; poll and frames are addressed by the
 * instance token alone, as on main. Every refusal answers in the relay's frame wire.
 */

import { INSTANCE_TOKEN_HEADER } from "@langwatch/agent-contract";
import { anyAuthenticated } from "@langwatch/api/access";
import {
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  type RestProtocolRefusal,
} from "@langwatch/api/rest";
import {
  LangyApi,
  registerFrameSchema,
  langyControlFramesBodySchema,
  langyControlPollQuerySchema,
} from "@langwatch/langy-contract";
import { z } from "zod";

import {
  type ConnectRefusalDocument,
  framesRefusalDocument,
  pollRefusalDocument,
  registerRefusalDocument,
} from "../rules/langy-local-control-connect.rules.ts";

const JSON_MEDIA_TYPE = "application/json";

const BECAUSE = "The local folder reads its answers and refusals as relay frames.";

const ADDRESSED_BY_INSTANCE_TOKEN =
  "addressed by the pod-local instance token register handed out, as on main; the session key " +
  "is checked once, at register";

function frameRefusal(document: (failure: Error) => ConnectRefusalDocument): RestProtocolRefusal {
  return ({ failure, response }) => {
    const { status, body } = document(failure);
    return response.write({ status, mediaType: JSON_MEDIA_TYPE, body: JSON.stringify(body) });
  };
}

const instanceTokenHeaders = z.object({ [INSTANCE_TOKEN_HEADER]: z.string().default("") });

export const langyLocalControlConnectRest = defineRestRouter(LangyApi)
  .withNamespace("langy")
  .withVersion(MANAGEMENT_API_VERSION)
  .withCredential("project")
  .withAddressing("literal", { v1Twin: true })

  .post("/api/langy/control/connect/register", "langyControlConnectRegister")
  .withCredential("sessionKey")
  .withAccess(anyAuthenticated({ reason: "the session-key door names the key's holder" }))
  .withInput(registerFrameSchema)
  .withHeaders(z.object({ authorization: z.string() }))
  .withResponse("protocol", {
    produces: JSON_MEDIA_TYPE,
    because: BECAUSE,
    refusal: frameRefusal(registerRefusalDocument),
  })
  .withDocs({
    description:
      "The registered frame with its instance token, or the refused frame with its reason.",
  })
  .handle(async ({ app, input, actor, scope, response }, headers) =>
    response.write({
      status: 200,
      mediaType: JSON_MEDIA_TYPE,
      body: JSON.stringify(
        await app.registerLocalControlSession({
          actor,
          projectId: scope.id,
          authorization: headers.authorization,
          frame: input,
        }),
      ),
    }),
  )

  .get("/api/langy/control/connect/poll", "langyControlConnectPoll")
  .withAccess({ kind: "public", reason: ADDRESSED_BY_INSTANCE_TOKEN })
  .withQuery(langyControlPollQuerySchema)
  .withHeaders(instanceTokenHeaders)
  .withResponse("protocol", {
    produces: JSON_MEDIA_TYPE,
    because: BECAUSE,
    refusal: frameRefusal(pollRefusalDocument),
  })
  .withDocs({
    description: "The frames waiting for the folder, or 410 when the instance token is not known.",
  })
  .handle(async ({ app, input, signal, response }, headers) =>
    response.write({
      status: 200,
      mediaType: JSON_MEDIA_TYPE,
      body: JSON.stringify(
        await app.pollLocalControlSession({
          instanceToken: headers[INSTANCE_TOKEN_HEADER],
          inFlightCallIds: (input.inFlight ?? "").split(",").filter(Boolean),
          signal,
        }),
      ),
    }),
  )

  .post("/api/langy/control/connect/frames", "langyControlConnectFrames")
  .withAccess({ kind: "public", reason: ADDRESSED_BY_INSTANCE_TOKEN })
  .withInput(langyControlFramesBodySchema)
  .withHeaders(instanceTokenHeaders)
  .withResponse("protocol", {
    produces: JSON_MEDIA_TYPE,
    because: BECAUSE,
    refusal: frameRefusal(framesRefusalDocument),
  })
  .withDocs({
    description: "How many frames were taken, or 410 when the instance token is not known.",
  })
  .handle(async ({ app, input, response }, headers) =>
    response.write({
      status: 200,
      mediaType: JSON_MEDIA_TYPE,
      body: JSON.stringify(
        await app.postLocalControlFrames({
          instanceToken: headers[INSTANCE_TOKEN_HEADER],
          frames: input.frames,
        }),
      ),
    }),
  )

  .build();

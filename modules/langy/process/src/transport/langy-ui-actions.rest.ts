/**
 * The agent-to-page UI-action dispatch surface — `langwatch ui call` / `langwatch ui actions` land
 * here, authenticated with the worker's own per-conversation session key.
 */

import { PayloadTooLargeError } from "@langwatch/api";
import { deferredScope } from "@langwatch/api/access";
import {
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  projectCredentialOfRequest,
  type RestAnswer,
  type RestProtocolProducer,
} from "@langwatch/api/rest";
import { LangyApi } from "@langwatch/langy-contract";

const AUTH_REASON =
  "the dispatched action's own kind names the permission it requires, so the ceiling is the " +
  "key's ceiling on THAT permission - only the handler, having read the body, knows which one";

/** An action payload is a small JSON document, never an upload. */
const MAX_ACTION_BODY_BYTES = 256 * 1024;

/** Hono's own 404, byte-for-byte what an unmounted path returns. */
const HONO_NOT_FOUND = {
  status: 404,
  mediaType: "text/plain;charset=UTF-8",
  body: "404 Not Found",
} as const;

/** The CLI's wire: the action outcome as JSON, or the dark surface's bare 404. */
const UI_ACTIONS_PRODUCES = ["application/json", "text/plain;charset=UTF-8"] as const;
const UI_ACTIONS_ANSWER = {
  produces: UI_ACTIONS_PRODUCES,
  because: "The CLI reads a bare 404 as the rollout being dark for the project.",
} as const;

type UiActionsProducer = RestProtocolProducer<typeof UI_ACTIONS_PRODUCES>;

function json(response: UiActionsProducer, body: unknown): RestAnswer<"protocol"> {
  return response.write({ status: 200, mediaType: "application/json", body: JSON.stringify(body) });
}

/** One dispatch, answered with langy's own outcome, or the dark surface's 404. */
async function dispatchUiAction(input: {
  app: LangyApi;
  request: Request;
  response: UiActionsProducer;
  raw: string;
  actor: Parameters<LangyApi["dispatchUiAction"]>[0]["actor"];
}): Promise<RestAnswer<"protocol">> {
  const credential = projectCredentialOfRequest(input.request);
  const dispatched = await input.app.dispatchUiAction({
    actor: input.actor,
    projectId: credential.project.id,
    credential,
    raw: input.raw,
  });
  if (dispatched.dark) return input.response.write(HONO_NOT_FOUND);
  return json(input.response, dispatched.outcome);
}

/** The catalogue, or the dark surface's 404. */
async function listUiActions(input: {
  app: LangyApi;
  request: Request;
  response: UiActionsProducer;
  actor: Parameters<LangyApi["listUiActions"]>[0]["actor"];
}): Promise<RestAnswer<"protocol">> {
  const listed = await input.app.listUiActions({
    actor: input.actor,
    projectId: projectCredentialOfRequest(input.request).project.id,
  });
  if (listed.dark) return input.response.write(HONO_NOT_FOUND);
  return json(input.response, { actions: listed.actions });
}

export const langyUiActionsRest = defineRestRouter(LangyApi)
  .withNamespace("langy")
  .withVersion(MANAGEMENT_API_VERSION)
  .withCredential("project")
  .withAddressing("literal", { v1Twin: false })

  .post("/api/langy/ui/actions", "langyUiActionsDispatch")
  .withAccess(deferredScope({ reason: AUTH_REASON }))
  .withRawBody("text")
  .withBodyLimit({ maxBytes: MAX_ACTION_BODY_BYTES, onExceeded: () => new PayloadTooLargeError() })
  .withResponse("protocol", UI_ACTIONS_ANSWER)
  .withDocs({
    description:
      "The dispatch answers the action service's own outcome, and a plain 404 when the " +
      "rollout is dark for the project.",
  })
  .handle(async ({ app, raw, request, response, actor }) =>
    dispatchUiAction({ app, request, response, raw, actor }),
  )

  .get("/api/langy/ui/actions", "langyUiActionsList")
  .withAccess(deferredScope({ reason: AUTH_REASON }))
  .withResponse("protocol", UI_ACTIONS_ANSWER)
  .withDocs({
    description:
      "The catalogue publishes each action's own draft-07 payload schema, which the CLI " +
      "reads as it stands.",
  })
  .handle(async ({ app, request, response, actor }) =>
    listUiActions({ app, request, response, actor }),
  )

  .build();

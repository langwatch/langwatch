/**
 * The two doors the Optimization Studio editor talks to: literal addresses the
 * process mounts BEFORE the packaged workflow family. Code completion asks its
 * permission at the door; the event door keeps main's order (body 400 first).
 */
import { optionalCredential } from "@langwatch/api/access";
import { defineRestRouter, MANAGEMENT_API_VERSION, type RestEvent } from "@langwatch/api/rest";
import { resolveRequestBound } from "@langwatch/plans";
import {
  workflowCodeCompletionBodySchema,
  workflowCodeCompletionQuerySchema,
  workflowCodeCompletionResponseSchema,
  workflowStudioRestEventSchema,
  WorkflowApi,
  type StudioServerEvent,
} from "@langwatch/workflow-contract";

const BODY_LIMIT_JSON_BYTES = resolveRequestBound("bodyLimitJsonBytes", "ENTERPRISE");

/** Why the event door resolves its caller after the body rather than standing behind a door. */
const EVENT_CHECKED_BEFORE_CALLER =
  "the event door answers an invalid body 400 before it asks who is calling, as main did; the " +
  "project it asks workflows:manage at is inside that body, so the app asks it after the check";

export const workflowStudioRest = defineRestRouter(WorkflowApi)
  .withNamespace("workflow-studio")
  .withVersion(MANAGEMENT_API_VERSION)
  .withCredential("browser")
  .withAddressing("literal", { v1Twin: false })

  .post("/api/workflows/code-completion", "completeWorkflowCode")
  .withQuery(workflowCodeCompletionQuerySchema)
  .withInput(workflowCodeCompletionBodySchema)
  .withBodyLimit({ maxBytes: BODY_LIMIT_JSON_BYTES })
  .withPermission("workflows:manage", { at: "route", param: "projectId" })
  .withOutput(workflowCodeCompletionResponseSchema)
  .handle(({ app, input, actor }) => {
    const { projectId, ...body } = input;
    return app.completeCode({
      projectId,
      body,
      userId: actor?.type === "user" ? actor.id : undefined,
    });
  })

  .post("/api/workflows/post_event", "postWorkflowStudioEvent")
  .withRawBody("text", { mediaType: "application/json" })
  .withBodyLimit({ maxBytes: BODY_LIMIT_JSON_BYTES })
  .withAccess(optionalCredential({ reason: EVENT_CHECKED_BEFORE_CALLER }))
  .withResponse("sse", {})
  .withDocs({ requestBody: { schema: workflowStudioRestEventSchema } })
  .handle(async ({ app, raw, response, actor }) =>
    response.events(
      studioSseEventsOf(
        await app.streamStudioEvent({
          body: raw,
          userId: actor?.type === "user" ? actor.id : undefined,
        }),
      ),
    ),
  )
  .build();

/** The engine's events as server-sent events, one JSON document per frame. */
async function* studioSseEventsOf(
  events: AsyncIterable<StudioServerEvent>,
): AsyncGenerator<RestEvent> {
  for await (const event of events) yield { data: JSON.stringify(event) };
}

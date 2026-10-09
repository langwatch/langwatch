/**
 * The two doors the Optimization Studio editor talks to: literal addresses the
 * process mounts BEFORE the packaged workflow family. Both ask workflows:manage at the door:
 * completion at the queried project, the event at the project its raw body names.
 */
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
  .handle(({ app, input }) => {
    const { projectId, ...body } = input;
    return app.completeCode({ projectId, body });
  })

  .post("/api/workflows/post_event", "postWorkflowStudioEvent")
  .withRawBody("text", { mediaType: "application/json" })
  .withBodyLimit({ maxBytes: BODY_LIMIT_JSON_BYTES })
  .withPermission("workflows:manage", {
    at: "body",
    param: "projectId",
    schema: workflowStudioRestEventSchema,
  })
  .withResponse("sse", {})
  .withDocs({ requestBody: { schema: workflowStudioRestEventSchema } })
  .handle(async ({ app, raw, response, actor }) =>
    response.events(
      studioSseEventsOf(await app.streamStudioEvent({ body: raw, userId: actor.id })),
    ),
  )
  .build();

/** The engine's events as server-sent events, one JSON document per frame. */
async function* studioSseEventsOf(
  events: AsyncIterable<StudioServerEvent>,
): AsyncGenerator<RestEvent> {
  for await (const event of events) yield { data: JSON.stringify(event) };
}

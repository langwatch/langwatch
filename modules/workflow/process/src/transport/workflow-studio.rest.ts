/**
 * The two doors the Optimization Studio editor talks to: literal addresses the
 * process mounts BEFORE the packaged workflow family, writing their own
 * answers, over a session that arrives as a fact so the refusals stay theirs.
 */
import { optionalCredential } from "@langwatch/api/access";
import {
  defineRestMiddleware,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  type RestEvent,
} from "@langwatch/api/rest";
import { resolveRequestBound } from "@langwatch/plans";
import {
  workflowCodeCompletionBodySchema,
  workflowCodeCompletionQuerySchema,
  workflowCodeCompletionResponseSchema,
  workflowStudioSessionSchema,
  workflowStudioRestEventSchema,
  WorkflowApi,
  type StudioServerEvent,
} from "@langwatch/workflow-contract";
import { HTTPException } from "hono/http-exception";

/** The 413 a body past its cap earns, in the plain sentence it has always been. */
const payloadTooLarge = (): Error =>
  new HTTPException(413, { res: new Response("Payload Too Large", { status: 413 }) });

const BODY_LIMIT_JSON_BYTES = resolveRequestBound("bodyLimitJsonBytes", "ENTERPRISE");

/** The signed-in person behind the request, as the mounting process resolves one. */
export const workflowStudioSession = defineRestMiddleware(
  "workflowStudioSession",
  workflowStudioSessionSchema,
);

/** Why both routes resolve their own caller rather than standing behind a door. */
const SESSION_RESOLVED_IN_HANDLER =
  "the studio editor's browser session is resolved by the family itself, which answers its own " +
  "401 and 403 in the sentences the editor renders; no API credential opens this door";

export const workflowStudioRest = defineRestRouter(WorkflowApi)
  .withNamespace("workflow-studio")
  .withVersion(MANAGEMENT_API_VERSION)
  .withCredential("browser")
  .withAddressing("literal", { v1Twin: false })

  // The door resolves the browser session; the handler then checks the
  // project named in the query against that session itself, so the gate is
  // authentication alone, never a spoofable tenant field.
  .post("/api/workflows/code-completion", "completeWorkflowCode")
  .withQuery(workflowCodeCompletionQuerySchema)
  .withInput(workflowCodeCompletionBodySchema)
  .withBodyLimit({ maxBytes: BODY_LIMIT_JSON_BYTES, onExceeded: payloadTooLarge })
  .withAccess({ kind: "authenticated", reason: SESSION_RESOLVED_IN_HANDLER })
  .withOutput(workflowCodeCompletionResponseSchema)
  .withMiddleware(workflowStudioSession)
  .handle(({ app, input }, session) => {
    const { projectId, ...body } = input;
    return app.completeCode({ projectId, body, userId: session?.user.id });
  })

  .post("/api/workflows/post_event", "postWorkflowStudioEvent")
  .withRawBody("text", { mediaType: "application/json" })
  .withBodyLimit({ maxBytes: BODY_LIMIT_JSON_BYTES, onExceeded: payloadTooLarge })
  .withAccess(optionalCredential({ reason: SESSION_RESOLVED_IN_HANDLER }))
  .withResponse("sse", {})
  .withDocs({ requestBody: { schema: workflowStudioRestEventSchema } })
  .withMiddleware(workflowStudioSession)
  .handle(async ({ app, raw, response }, session) =>
    response.events(
      studioSseEventsOf(await app.streamStudioEvent({ body: raw, userId: session?.user.id })),
    ),
  )
  .build();

/** The engine's events as server-sent events, one JSON document per frame. */
async function* studioSseEventsOf(
  events: AsyncIterable<StudioServerEvent>,
): AsyncGenerator<RestEvent> {
  for await (const event of events) yield { data: JSON.stringify(event) };
}

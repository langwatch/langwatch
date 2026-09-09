/**
 * The two doors the Optimization Studio editor talks to: literal addresses the
 * process mounts BEFORE the packaged workflow family, writing their own
 * answers, over a session that arrives as a fact so the refusals stay theirs.
 */
import { publicRoute } from "@langwatch/api/access";
import {
  defineRestMiddleware,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  type RestRawResult,
} from "@langwatch/api/rest";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";
import {
  LlmModelNotSetError,
  studioClientEventSchema,
  WorkflowApi,
  type StudioClientEvent,
} from "@langwatch/workflow-contract";
import { z } from "zod";

const logger = createLogger("langwatch:workflows");

/** The signed-in person behind the request, as the mounting process resolves one. */
export const workflowStudioSession = defineRestMiddleware(
  "workflowStudioSession",
  z.object({ user: z.object({ id: z.string() }) }).nullable(),
);

/** Why both routes resolve their own caller rather than standing behind a door. */
const SESSION_RESOLVED_IN_HANDLER =
  "the studio editor's browser session is resolved by the family itself, which answers its own " +
  "401 and 403 in the sentences the editor renders; no API credential opens this door";

const postEventBodySchema = z.object({
  projectId: z.string(),
  event: studioClientEventSchema,
});

/**
 * The event types the engine accepts. Stated as a set rather than a `switch`
 * with a default nothing can reach.
 */
const DISPATCHABLE_EVENT_TYPES = new Set<StudioClientEvent["type"]>([
  "is_alive",
  "stop_execution",
  "execute_component",
  "execute_flow",
  "execute_evaluation",
  "stop_evaluation_execution",
  "execute_optimization",
  "stop_optimization_execution",
]);

/** One JSON answer, in the bare shape both routes have always written. */
function jsonAnswer(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** The handled CODE an error carries, or nothing. */
function handledCodeOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;

  const code = (error as { code: unknown }).code;

  return typeof code === "string" ? code : undefined;
}

/** The posted body as sent, whatever JSON value it was; nothing when unparseable. */
function postedBody(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** The posted document, or nothing where the body was not a JSON object. */
function postedJson(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw);

    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export const workflowStudioRest = defineRestRouter(WorkflowApi)
  .withNamespace("workflow-studio")
  .withVersion(MANAGEMENT_API_VERSION)
  .withCredential("session")
  .withAddressing("literal", { v1Twin: false })

  // The project is read off the query rather than declared as one: a route
  // that resolves no credential may not name a scope field in its own input,
  // and this family checks the project itself, in the handler, against the
  // session it resolved.
  .post("/api/workflows/code-completion", "completeWorkflowCode")
  .withRawBody("text", { mediaType: "application/json" })
  .withAccess(publicRoute({ reason: SESSION_RESOLVED_IN_HANDLER }))
  .withRawResponse({ produces: "application/json" })
  .withMiddleware(workflowStudioSession)
  .handle(async ({ app, raw, request }, session): Promise<RestRawResult> => {
    if (!session) {
      return jsonAnswer({ error: "You must be logged in to access this endpoint." }, 401);
    }

    const projectId = new URL(request.url).searchParams.get("projectId");

    if (!projectId) return jsonAnswer({ error: "Project ID is required." }, 400);

    if (
      !(await app.hasProjectPermission({
        userId: session.user.id,
        projectId,
        permission: "workflows:manage",
      }))
    ) {
      return jsonAnswer({ error: "You do not have permission to access this endpoint." }, 403);
    }

    try {
      return jsonAnswer(await app.completeCode({ projectId, body: postedBody(raw) }), 200);
    } catch (error) {
      logger.error(
        {
          err: error,
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          projectId,
        },
        "code-completion failed",
      );
      app.reportStudioFailure(error, { projectId });

      // Generic on purpose (ADR-045): the cause is on the log line above.
      return jsonAnswer({ error: "Code completion failed." }, 500);
    }
  })

  .post("/api/workflows/post_event", "postWorkflowStudioEvent")
  .withRawBody("text", { mediaType: "application/json" })
  .withAccess(publicRoute({ reason: SESSION_RESOLVED_IN_HANDLER }))
  .withRawResponse({ produces: ["text/event-stream", "application/json"] })
  .withDocs({ requestBody: { schema: postEventBodySchema } })
  .withMiddleware(workflowStudioSession)
  .handle(async ({ app, raw }, session): Promise<RestRawResult> => {
    const posted = postedJson(raw);
    const validated = posted ? postEventBodySchema.safeParse(posted) : null;

    if (!posted || !validated?.success) return jsonAnswer({ error: "Invalid body" }, 400);

    // The VALIDATED body is the 400 gate; the handler forwards the body as
    // sent. `studioClientEventSchema` is a discriminated union over object
    // schemas, so parsing it would strip the node payload keys the engine
    // reads back out - which is why the route this replaces validated and then
    // re-read the raw JSON, and why this one does too.
    const projectId = validated.data.projectId;
    const eventWithoutEnvs = posted.event as StudioClientEvent;

    logger.info({ event: eventWithoutEnvs.type, projectId }, "post_event");

    if (!session) {
      return jsonAnswer({ error: "You must be logged in to access this endpoint." }, 401);
    }

    if (
      !(await app.hasProjectPermission({
        userId: session.user.id,
        projectId,
        permission: "workflows:manage",
      }))
    ) {
      return jsonAnswer({ error: "You do not have permission to access this endpoint." }, 403);
    }

    let message: StudioClientEvent;

    try {
      message = await app.prepareStudioEvent({ event: eventWithoutEnvs, projectId });
    } catch (error) {
      return preparationRefusal({ app, error, projectId });
    }

    if (!DISPATCHABLE_EVENT_TYPES.has(message.type)) {
      return jsonAnswer({ error: `Unknown event type on server: ${message.type}` }, 400);
    }

    // Optimization was DSPy-only and the Go engine dropped it. Stop events
    // still pass so a previously-started run can be cancelled.
    if (message.type === "execute_optimization") {
      return jsonAnswer(
        {
          type: "optimize_disabled",
          message:
            "Optimization is no longer supported. The Optimize feature relied on DSPy, which " +
            "has been removed.",
        },
        410,
      );
    }

    return {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
      body: studioEventStream({ app, projectId, message }),
    };
  })
  .build();

/** What a graph that could not be prepared answers, by the cause it names. */
function preparationRefusal({
  app,
  error,
  projectId,
}: {
  app: WorkflowApi;
  error: unknown;
  projectId: string;
}): Response {
  // Loading a dataset that is still preparing is a client-precondition
  // failure, not a server fault - a clean 425 and no incident report. Matched
  // on the handled CODE: the dataset module's own class lives in another
  // module's server package, which this one may not name.
  if (handledCodeOf(error) === "dataset_not_ready") {
    return jsonAnswer({ error: error instanceof Error ? error.message : String(error) }, 425);
  }

  // A node reached dispatch with no model: fixable in the editor.
  if (error instanceof LlmModelNotSetError) return jsonAnswer({ error: error.message }, 422);

  logger.error({ error, projectId }, "error");
  app.reportStudioFailure(error, { projectId });

  return jsonAnswer({ error: "Could not prepare this event." }, 500);
}

/**
 * The engine's events, framed as a server-sent-event stream. A `done` event
 * leaves the stream open one more second so a trailing frame still reaches the
 * editor; the run settling closes it either way.
 */
function studioEventStream({
  app,
  projectId,
  message,
}: {
  app: WorkflowApi;
  projectId: string;
  message: StudioClientEvent;
}): ReadableStream {
  const encoder = new TextEncoder();

  return new ReadableStream({
    start(controller) {
      let closed = false;
      const close = () => {
        if (closed) return;

        closed = true;
        controller.close();
      };
      const write = (payload: unknown) => {
        if (!closed) controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };

      void app
        .postStudioEvent({
          projectId,
          event: message,
          onEvent: (serverEvent) => {
            write(serverEvent);

            if (serverEvent.type === "done") setTimeout(close, 1000);
          },
        })
        .catch((error: unknown) => {
          logger.error({ error }, "Error handling message");
          write(failureFrame({ error, message }));
        })
        .finally(close);
    },
  });
}

/** The frame a failed run writes: against the node it names, or on its own. */
function failureFrame({ error, message }: { error: unknown; message: StudioClientEvent }): unknown {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const nodeId =
    "node_id" in message.payload ? (message.payload.node_id as string | undefined) : undefined;

  if (!nodeId) return { type: "error", payload: { message: errorMessage } };

  return {
    type: "component_state_change",
    payload: {
      component_id: nodeId,
      execution_state: {
        status: "error",
        error: errorMessage,
        timestamps: { finished_at: nowInstant().epochMilliseconds },
      },
    },
  };
}

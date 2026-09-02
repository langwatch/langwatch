/**
 * The two doors the Optimization Studio editor talks to:
 * `POST /api/workflows/code-completion` and `POST /api/workflows/post_event`.
 *
 * Both are `handlerManagedAuth({ credential: "session" })` families: they
 * resolve the signed-in person themselves and publish a bare `{ error }` at
 * 401 and 403, which is the wire the editor has always read. Routing them onto
 * the framework's authenticate-then-authorize chain would change both bodies,
 * so the session arrives as a port instead — the same shape the run export
 * next door uses.
 *
 * What each door dispatches through is a port for the same reason it is on the
 * experiment run loop: the engine's address, the model a feature key resolves
 * to and the product-analytics sink are facts of the PROCESS, not of a
 * workflow. This family owns the wire — the status codes, the SSE framing and
 * the order the refusals come in — and nothing else.
 *
 * `post_event`'s ordering is load-bearing and is transcribed rather than
 * tidied: session, then permission, then `prepareStudioEvent` (whose two
 * expected failures answer 425 and 422 without reporting an incident), then
 * the event-type allow-list, then the retired optimization gate at 410, and
 * only then the stream. A run is WATCHED rather than awaited, so once the
 * stream opens a failure is reported as a studio event on the stream rather
 * than as a status code — that half lives in `WorkflowStudioDispatchService`.
 */
import { handlerManagedAuth } from "@langwatch/api";
import {
  type AppRestSecurity,
  type MountableRestApp,
  validator as zValidator,
} from "@langwatch/api/rest";
import { createLogger } from "@langwatch/observability";
import { streamSSE } from "hono/streaming";
import { z } from "zod";

import {
  LlmModelNotSetError,
  type StudioClientEvent,
  type StudioServerEvent,
  studioClientEventSchema,
} from "@langwatch/workflow-contract";

const logger = createLogger("langwatch:workflows");

/** The signed-in person these two doors read. */
export type WorkflowStudioRestSession = Readonly<{ user: Readonly<{ id: string }> }>;

/** One studio run, as this family dispatches it. */
export type WorkflowStudioRestDispatch = (input: {
  projectId: string;
  event: StudioClientEvent;
  onEvent: (event: StudioServerEvent) => void;
}) => Promise<void>;

/**
 * What the studio editor's two doors reach that they do not own.
 *
 * `completeCode` is a port rather than a model call written here because WHICH
 * model answers an editor completion is the deployment's cascade, and the
 * prompt framing around it is the editor library's. The package that owns
 * neither is this one.
 */
export interface WorkflowStudioRestPorts<TSession extends WorkflowStudioRestSession> {
  /** The live session behind this request, or null when there is none. */
  resolveSession(request: Request): Promise<TSession | null>;
  /** Whether that session holds `workflows:manage` on the project. */
  probeProjectPermission(
    session: TSession,
    projectId: string,
    permission: "workflows:manage",
  ): Promise<boolean>;
  /** One Monaco completion for the editor, over whichever model answers it. */
  completeCode(input: { projectId: string; body: unknown }): Promise<unknown>;
  /** Resolves a client event's environment before it is dispatched. */
  prepareStudioEvent(input: {
    event: StudioClientEvent;
    projectId: string;
  }): Promise<StudioClientEvent>;
  /** Opens the run and streams the engine's events back through `onEvent`. */
  postEvent: WorkflowStudioRestDispatch;
  /** Where an unexpected failure is reported. Best-effort; absent is fine. */
  reportError?: ((error: unknown, context: { projectId: string }) => void) | undefined;
}

/**
 * The handled CODE an error carries, or nothing.
 *
 * Read off the value rather than matched with `instanceof`: the two classes
 * this route tells apart are declared in another feature's SERVER package,
 * which this one may not name, and a code comparison is what the repository
 * asks for anywhere an error may have crossed a package or serialisation
 * boundary.
 */
function handledCodeOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const code = (error as { code: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

const postEventBodySchema = z.object({
  projectId: z.string(),
  event: studioClientEventSchema,
});

/**
 * The event types the engine accepts.
 *
 * Stated as a set rather than a `switch` with a `@ts-expect-error` default,
 * which is what it was: the union widens whenever the contract does, and an
 * unknown type must answer 400 rather than reach the engine.
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

/** `/api/workflows/{code-completion,post_event}`, bound to one process. */
export function createWorkflowStudioRestApp<TSession extends WorkflowStudioRestSession>(options: {
  security: AppRestSecurity;
  ports: WorkflowStudioRestPorts<TSession>;
}): MountableRestApp {
  const { security, ports } = options;
  const secured = security.createServiceApp({ basePath: "/api/workflows" });

  const sessionAuth = () =>
    handlerManagedAuth({
      reason: "user session validated in-handler via the process's session resolver",
      permissions: ["workflows:manage"],
      credential: "session",
    });

  secured.access(sessionAuth()).post("/code-completion", async (c) => {
    const body = await c.req.json();

    const session = await ports.resolveSession(c.req.raw);
    if (!session) {
      return c.json({ error: "You must be logged in to access this endpoint." }, 401);
    }

    const { projectId } = c.req.query();
    if (!projectId) {
      return c.json({ error: "Project ID is required." }, 400);
    }

    if (!(await ports.probeProjectPermission(session, projectId, "workflows:manage"))) {
      return c.json({ error: "You do not have permission to access this endpoint." }, 403);
    }

    try {
      return c.json(await ports.completeCode({ projectId, body }));
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
      ports.reportError?.(error, { projectId });
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  secured
    .access(sessionAuth())
    .post("/post_event", zValidator("json", postEventBodySchema), async (c) => {
      // The VALIDATED body is the 400 gate; the handler forwards the body as
      // sent. `studioClientEventSchema` is a discriminated union over object
      // schemas, so parsing it would strip the node payload keys the engine
      // reads back out — which is why the route this replaces validated and
      // then re-read the raw JSON, and why this one does too.
      const { event: eventWithoutEnvs, projectId } = (await c.req.json()) as z.infer<
        typeof postEventBodySchema
      >;
      logger.info({ event: eventWithoutEnvs.type, projectId }, "post_event");

      const session = await ports.resolveSession(c.req.raw);
      if (!session) {
        return c.json({ error: "You must be logged in to access this endpoint." }, 401);
      }

      if (!(await ports.probeProjectPermission(session, projectId, "workflows:manage"))) {
        return c.json({ error: "You do not have permission to access this endpoint." }, 403);
      }

      let message: StudioClientEvent;
      try {
        message = await ports.prepareStudioEvent({ event: eventWithoutEnvs, projectId });
      } catch (error) {
        // Loading a dataset that is still preparing is a client-precondition
        // failure, not a server fault — a clean 425 and no incident report.
        // Matched on the handled CODE: the dataset feature's own class is in
        // another feature's server package, which this one may not name.
        if (handledCodeOf(error) === "dataset_not_ready") {
          return c.json({ error: (error as Error).message }, 425);
        }
        // A node reached dispatch with no model: fixable in the editor.
        if (error instanceof LlmModelNotSetError) {
          return c.json({ error: error.message, cause: error.cause }, 422);
        }
        logger.error({ error, projectId }, "error");
        ports.reportError?.(error, { projectId });
        return c.json({ error: (error as Error).message }, 500);
      }

      if (!DISPATCHABLE_EVENT_TYPES.has(message.type)) {
        return c.json({ error: `Unknown event type on server: ${message.type}` }, 400);
      }

      // Optimization was DSPy-only and the Go engine dropped it. Stop events
      // still pass so a previously-started run can be cancelled.
      if (message.type === "execute_optimization") {
        return c.json(
          {
            type: "optimize_disabled",
            message:
              "Optimization is no longer supported. The Optimize feature relied on DSPy, which has been removed.",
          },
          410,
        );
      }

      return streamSSE(c, async (stream) => {
        let resolved = false;
        await new Promise<void>((resolve) => {
          const resolveOnce = () => {
            if (!resolved) {
              resolved = true;
              resolve();
            }
          };

          void ports
            .postEvent({
              projectId,
              event: message,
              onEvent: (serverEvent) => {
                void stream.writeSSE({ data: JSON.stringify(serverEvent) });
                if (serverEvent.type === "done") {
                  setTimeout(resolveOnce, 1000);
                }
              },
            })
            .catch((error: unknown) => {
              logger.error({ error }, "Error handling message");
              const errorMessage = error instanceof Error ? error.message : String(error);
              const nodeId =
                "node_id" in message.payload ? (message.payload.node_id as string | undefined) : undefined;

              void stream.writeSSE({
                data: JSON.stringify(
                  nodeId
                    ? {
                        type: "component_state_change",
                        payload: {
                          component_id: nodeId,
                          execution_state: {
                            status: "error",
                            error: errorMessage,
                            timestamps: { finished_at: Date.now() },
                          },
                        },
                      }
                    : { type: "error", payload: { message: errorMessage } },
                ),
              });
            })
            .finally(resolveOnce);
        });
      });
    });

  return secured.hono;
}

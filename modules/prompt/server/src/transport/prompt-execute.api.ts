/**
 * The prompt playground's execution door: `POST /api/prompt-playground/<version>/prompt.execute`.
 *
 * Replaces the CopilotKit GraphQL runtime that used to sit behind
 * `/api/copilotkit`. That runtime carried graphql-yoga, type-graphql and five
 * langchain packages into every backend process in order to forward text deltas
 * from our own workflow engine — which is all it ever did.
 *
 * The browser posts what the playground actually holds (a prompt form, its
 * variables, the conversation so far) rather than a workflow. Building the
 * workflow server-side keeps the engine's input off the wire, and keeps the
 * `{{input}}` binding rules in one tested place.
 *
 * It is deliberately NOT the `/api/prompts` family: that one is the documented,
 * API-key-authenticated SDK surface, and this is a browser endpoint with no
 * stable contract, kept out of the published OpenAPI document.
 */
import { handlerManagedAuth } from "@langwatch/api";
import {
  type AppRestSecurity,
  type MountableRestApp,
  validator as zValidator,
} from "@langwatch/api/rest";
import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import {
  executeRequestSchema,
  parseLLMError,
  type PlaygroundStreamEvent,
  PROMPT_EXECUTE_PATH,
  PROMPT_PLAYGROUND_BASE_PATH,
  type PromptExecuteRequest,
} from "@langwatch/prompt-contract";
import { LlmModelNotSetError, type StudioServerEvent } from "@langwatch/workflow-contract";
import type { SSEStreamingApi } from "hono/streaming";
import { streamSSE } from "hono/streaming";

import { buildPromptExecutionEvent, outputConfigsFor } from "#rules/prompt-execution-event.rules";
import { handleEngineEvent } from "#rules/prompt-execution-stream.rules";
import type { StudioClientEvent } from "@langwatch/workflow-contract";

const logger = createLogger("langwatch:prompt-playground");

/** The signed-in person this door reads. */
export type PromptExecuteRestSession = Readonly<{ user: Readonly<{ id: string }> }>;

/**
 * A state-changing request whose Origin/Referer is not the app itself. The
 * session cookie rides along on such requests automatically, so they are
 * refused before the session is even read.
 */
export class CrossOriginRefusedError extends HandledError {
  declare readonly code: "cross_origin_refused";

  constructor() {
    super("cross_origin_refused", "This endpoint only accepts requests from the LangWatch app", {
      httpStatus: 403,
      fault: "customer",
    });
    this.name = "CrossOriginRefusedError";
  }
}

/** What this door reaches that it does not own. */
export interface PromptExecuteRestMembers<TSession extends PromptExecuteRestSession> {
  /** Whether a state-changing request came from the app's own origin. */
  isAllowedOrigin(input: {
    method: string;
    origin: string | undefined;
    referer: string | undefined;
  }): boolean;
  /** The live session behind this request, or null when there is none. */
  resolveSession(request: Request): Promise<TSession | null>;
  /** Whether that session holds `prompts:view` on the project. */
  probeProjectPermission(
    session: TSession,
    projectId: string,
    permission: "prompts:view",
  ): Promise<boolean>;
  /**
   * The shared demo project, whose blanket `prompts:view` grant to every
   * signed-in user is a *view* grant — execution spends provider credit.
   */
  isDemoProject(projectId: string): boolean;
  /** Resolves a client event's environment and datasets before dispatch. */
  prepareStudioEvent(input: {
    event: StudioClientEvent;
    projectId: string;
  }): Promise<StudioClientEvent>;
  /** Opens the run and streams the engine's events back through `onEvent`. */
  postEvent(input: {
    projectId: string;
    event: StudioClientEvent;
    onEvent: (event: StudioServerEvent) => void;
    isAborted?: () => Promise<boolean>;
  }): Promise<void>;
  /** The id the run is traced under, allocated before anything can throw. */
  newTraceId(): string;
  /** Where an unexpected failure is reported. Best-effort; absent is fine. */
  reportError?: ((error: unknown, context: { projectId: string }) => void) | undefined;
}

/** The handled CODE an error carries, or nothing. */
function handledCodeOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const code = (error as { code: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/** Runs one execution, reporting it on the SSE stream. */
async function streamPromptExecution({
  stream,
  projectId,
  preparedEvent,
  traceId,
  outputConfigs,
  postEvent,
}: {
  stream: SSEStreamingApi;
  projectId: string;
  preparedEvent: StudioClientEvent;
  traceId: string;
  outputConfigs: ReturnType<typeof outputConfigsFor>;
  postEvent: PromptExecuteRestMembers<PromptExecuteRestSession>["postEvent"];
}): Promise<void> {
  let aborted = false;
  stream.onAbort(() => {
    aborted = true;
  });

  // Writes are chained, not awaited at the call site: the engine reports
  // events synchronously, and the stream helper below must not resolve until
  // the last chained write has flushed — hono closes the stream the moment the
  // callback settles, dropping anything still queued.
  let pendingWrites: Promise<unknown> = Promise.resolve();
  const send = (event: PlaygroundStreamEvent) => {
    pendingWrites = pendingWrites
      .then(() => stream.writeSSE({ data: JSON.stringify(event) }))
      // A reader who navigated away is the expected cause, and the chain is
      // what `finally` awaits: unhandled, one rejection travels down every
      // later `.then` and turns a disconnect into a route failure.
      .catch((error) => {
        logger.debug({ error, projectId }, "playground stream write failed");
      });
  };

  let sentSoFar = "";
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    send({ type: "done" });
  };

  send({ type: "start", messageId: traceId, traceId });

  try {
    await postEvent({
      projectId,
      event: preparedEvent,
      isAborted: () => Promise.resolve(aborted),
      onEvent: (serverEvent: StudioServerEvent) => {
        const result = handleEngineEvent({
          serverEvent,
          outputConfigs,
          sentSoFar,
          send,
        });
        sentSoFar = result.sent;
        if (result.done) finish();
      },
    });
  } catch (error) {
    logger.error({ error, projectId }, "prompt execution failed");
    send({
      type: "error",
      error: parseLLMError(error instanceof Error ? error.message : String(error)),
    });
  } finally {
    finish();
    await pendingWrites;
  }
}

/** `/api/prompt-playground/<version>/prompt.execute`, bound to one process. */
export function createPromptExecuteRestApp<TSession extends PromptExecuteRestSession>(options: {
  security: AppRestSecurity;
  ports: PromptExecuteRestMembers<TSession>;
}): MountableRestApp {
  const { security, ports } = options;
  const secured = security.createServiceApp({ basePath: PROMPT_PLAYGROUND_BASE_PATH });

  // The check is real but not expressible as a bare `permission`: it also
  // refuses the demo project, whose blanket `prompts:view` grant is a *view*
  // grant and execution spends provider credit.
  const sessionAuth = () =>
    handlerManagedAuth({
      reason:
        "browser session resolved in-handler behind an origin gate; prompts:view checked " +
        "against the body's projectId, with the demo project refused because execution " +
        "spends provider credit",
      permissions: ["prompts:view"],
      credential: "session",
    });

  secured
    .access(sessionAuth())
    .post(PROMPT_EXECUTE_PATH, zValidator("json", executeRequestSchema), async (c) => {
      // The origin gate runs before the session is read: the session cookie's
      // only browser-side protection is SameSite=Lax, which is a site boundary
      // rather than an origin one, so a sibling subdomain slips past it.
      const allowed = ports.isAllowedOrigin({
        method: c.req.method,
        origin: c.req.header("origin"),
        referer: c.req.header("referer"),
      });
      if (!allowed) {
        // The detail lives in the log, not the response: a misconfigured base
        // URL and a real cross-site POST must be tellable apart somewhere.
        logger.warn(
          {
            origin: c.req.header("origin"),
            referer: c.req.header("referer"),
            path: c.req.path,
          },
          "refused cross-origin playground request",
        );
        throw new CrossOriginRefusedError();
      }

      const session = await ports.resolveSession(c.req.raw);
      if (!session) {
        return c.json({ error: "You must be logged in to access this endpoint." }, 401);
      }

      const { projectId, formValues, variables, messages, threadId } = c.req.valid(
        "json",
      ) as PromptExecuteRequest;

      const permitted =
        !ports.isDemoProject(projectId) &&
        (await ports.probeProjectPermission(session, projectId, "prompts:view"));
      if (!permitted) {
        return c.json({ error: "You do not have permission to access this endpoint." }, 403);
      }

      // Allocated before anything that can throw: the error path streams under
      // the same id, so the conversation's trace affordance points at the run
      // that failed rather than at nothing (#853).
      const traceId = ports.newTraceId();

      let preparedEvent: StudioClientEvent;
      try {
        preparedEvent = await ports.prepareStudioEvent({
          projectId,
          event: buildPromptExecutionEvent({
            formValues,
            messages,
            variables,
            traceId,
            threadId: threadId ?? traceId,
          }),
        });
      } catch (error) {
        // A dataset still normalising is a client precondition, not a fault.
        // Matched on the handled CODE: the dataset feature's own class is in
        // another feature's server package, which this one may not name.
        if (handledCodeOf(error) === "dataset_not_ready") {
          return c.json({ error: (error as Error).message }, 425);
        }
        // A node with no model is fixable in the editor, not a server fault.
        if (error instanceof LlmModelNotSetError) {
          return c.json({ error: error.message }, 422);
        }
        logger.error({ error, projectId }, "could not prepare a playground run");
        ports.reportError?.(error, { projectId });
        return c.json({ error: "Could not prepare this prompt run." }, 500);
      }

      // hono's streamSSE sets the content type, cache and connection headers
      // but not this one, and a reverse proxy that buffers the response would
      // hold every event until the run finished — which is indistinguishable
      // from the engine not streaming at all.
      c.header("X-Accel-Buffering", "no");

      return streamSSE(c, (stream) =>
        streamPromptExecution({
          stream,
          projectId,
          preparedEvent,
          traceId,
          outputConfigs: outputConfigsFor(formValues),
          postEvent:
            ports.postEvent as PromptExecuteRestMembers<PromptExecuteRestSession>["postEvent"],
        }),
      );
    });

  return secured.mountable;
}

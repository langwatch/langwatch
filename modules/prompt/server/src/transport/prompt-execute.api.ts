/**
 * The playground's execution door: POST /api/prompt-playground/<version>/prompt.execute. Replaces
 * CopilotKit's GraphQL runtime with server-side workflow building and {{input}} binding rules;
 * not the /api/prompts SDK surface, browser-only endpoint.
 */
import { deferredScope } from "@langwatch/api/access";
import {
  defineRestMiddleware,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
} from "@langwatch/api/rest";
import { createLogger } from "@langwatch/observability";
import {
  executeRequestSchema,
  CrossOriginRefusedError,
  parseLLMError,
  PromptApi,
  PromptPlaygroundNotPermittedError,
  PromptPlaygroundSignInRequiredError,
  type PlaygroundStreamEvent,
  PROMPT_EXECUTE_ENDPOINT,
} from "@langwatch/prompt-contract";
import { LlmModelNotSetError, type StudioServerEvent } from "@langwatch/workflow-contract";
import { z } from "zod";

import { buildPromptExecutionEvent, outputConfigsFor } from "#rules/prompt-execution-event.rules";
import { handleEngineEvent } from "#rules/prompt-execution-stream.rules";
import type { StudioClientEvent } from "@langwatch/workflow-contract";

const logger = createLogger("langwatch:prompt-playground");

const AUTH_REASON =
  "browser session resolved in-handler behind an origin gate; prompts:view checked against " +
  "the body's projectId, with the demo project refused because execution spends provider credit";

/** The signed-in person this door reads. */
export type PromptExecuteRestSession = Readonly<{ user: Readonly<{ id: string }> }>;

/** Session-bearing state changes are refused before session lookup when cross-origin. */
/** What this door reaches that it does not own. */
export interface PromptExecuteRestMembers<TSession extends PromptExecuteRestSession> {
  /** Whether a state-changing request came from the app's own origin. */
  isAllowedOrigin(input: {
    method: string;
    origin: string | undefined;
    referer: string | undefined;
  }): boolean;
  /** The live session behind this request, or null when there is none. */
  findSession(request: Request): Promise<TSession | null>;
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
  /**
   * Counts this run against the project's window and refuses a message array
   * above the plan's bound. Runs after the permission probe and before any
   * LLM work; the refusal is the door's own 429/422.
   */
  assertExecuteWithinBounds(input: { projectId: string; messageCount: number }): Promise<void>;
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

/** What the process supplies this door beyond `PromptApi` and its own door. */
export const promptExecuteRestMembers = defineRestMiddleware(
  "promptExecuteRestMembers",
  z.custom<PromptExecuteRestMembers<PromptExecuteRestSession>>(),
);

/** The handled CODE an error carries, or nothing. */
function findHandledCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const code = (error as { code: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/** One SSE frame, in the exact wire shape `hono/streaming`'s `writeSSE` writes. */
function sseFrame(event: PlaygroundStreamEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

/**
 * A `text/event-stream` `Response` a `withRawResponse` route can return
 * directly — the seam `defineRestRouter` publishes for a route that writes
 * its own bytes, used here exactly as the auth door's own raw 302 uses it.
 */
function createSseResponse(
  run: (send: (event: PlaygroundStreamEvent) => void, isAborted: () => boolean) => Promise<void>,
): Response {
  let aborted = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: PlaygroundStreamEvent) => {
        if (aborted) return;
        try {
          controller.enqueue(sseFrame(event));
        } catch {
          // The reader is already gone; further writes are unobservable, and
          // the run is told to stop rather than keep producing for nobody.
          aborted = true;
        }
      };
      try {
        await run(send, () => aborted);
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed by a cancel(); the stream is gone either way.
          aborted = true;
        }
      }
    },
    cancel() {
      aborted = true;
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      // hono's streamSSE sets the content type, cache and connection headers
      // but not this one, and a reverse proxy that buffers the response would
      // hold every event until the run finished — which is indistinguishable
      // from the engine not streaming at all.
      "X-Accel-Buffering": "no",
    },
  });
}

/** Runs one execution, reporting it on the SSE stream. */
async function streamPromptExecution({
  send,
  isAborted,
  projectId,
  preparedEvent,
  traceId,
  outputConfigs,
  postEvent,
}: {
  send: (event: PlaygroundStreamEvent) => void;
  isAborted: () => boolean;
  projectId: string;
  preparedEvent: StudioClientEvent;
  traceId: string;
  outputConfigs: ReturnType<typeof outputConfigsFor>;
  postEvent: PromptExecuteRestMembers<PromptExecuteRestSession>["postEvent"];
}): Promise<void> {
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
      isAborted: () => Promise.resolve(isAborted()),
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
  }
}

/** `/api/prompt-playground/<version>/prompt.execute`, bound to one process. */
export const promptExecuteRest = defineRestRouter(PromptApi)
  .withNamespace("prompt-playground")
  .withVersion(MANAGEMENT_API_VERSION)
  .withCredential("browser")
  .withAddressing("literal", { v1Twin: false })

  .post(PROMPT_EXECUTE_ENDPOINT, "promptExecute")
  .withAccess(deferredScope({ reason: AUTH_REASON }))
  .withInput(executeRequestSchema)
  .withRawResponse({ produces: ["application/json", "text/event-stream"] })
  .withDocs({
    description:
      "Not a stable contract - deliberately kept out of the published OpenAPI document. " +
      "Streams Server-Sent Events on success.",
  })
  .withMiddleware(promptExecuteRestMembers)
  .handle(async ({ input, request }, members) => {
    // The origin gate runs before the session is read: the session cookie's
    // only browser-side protection is SameSite=Lax, which is a site boundary
    // rather than an origin one, so a sibling subdomain slips past it.
    const allowed = members.isAllowedOrigin({
      method: request.method,
      origin: request.headers.get("origin") ?? undefined,
      referer: request.headers.get("referer") ?? undefined,
    });
    if (!allowed) {
      // The detail lives in the log, not the response: a misconfigured base
      // URL and a real cross-site POST must be tellable apart somewhere.
      logger.warn(
        {
          origin: request.headers.get("origin"),
          referer: request.headers.get("referer"),
          path: new URL(request.url).pathname,
        },
        "refused cross-origin playground request",
      );
      throw new CrossOriginRefusedError();
    }

    const session = await members.findSession(request);
    if (!session) {
      throw new PromptPlaygroundSignInRequiredError();
    }

    const { projectId, formValues, variables, messages, threadId } = input;

    const permitted =
      !members.isDemoProject(projectId) &&
      (await members.probeProjectPermission(session, projectId, "prompts:view"));
    if (!permitted) {
      throw new PromptPlaygroundNotPermittedError();
    }

    // Counted after the permission probe: a caller without standing never
    // reaches the budget, and a refused caller never spends it.
    await members.assertExecuteWithinBounds({ projectId, messageCount: messages.length });

    // Allocated before anything that can throw: the error path streams under
    // the same id, so the conversation's trace affordance points at the run
    // that failed rather than at nothing (#853).
    const traceId = members.newTraceId();

    let preparedEvent: StudioClientEvent;
    try {
      preparedEvent = await members.prepareStudioEvent({
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
      if (findHandledCode(error) === "dataset_not_ready") {
        throw error;
      }
      // A node with no model is fixable in the editor, not a server fault.
      if (error instanceof LlmModelNotSetError) {
        return Response.json({ error: error.message }, { status: 422 });
      }
      logger.error({ error, projectId }, "could not prepare a playground run");
      members.reportError?.(error, { projectId });
      throw error;
    }

    return createSseResponse((send, isAborted) =>
      streamPromptExecution({
        send,
        isAborted,
        projectId,
        preparedEvent,
        traceId,
        outputConfigs: outputConfigsFor(formValues),
        postEvent: members.postEvent,
      }),
    );
  })

  .build();

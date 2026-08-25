/**
 * Prompt playground execution endpoint.
 *
 * Replaces the CopilotKit GraphQL runtime that used to sit here. That runtime
 * carried graphql-yoga, type-graphql and five langchain packages into every
 * backend process in order to forward text deltas from our own workflow engine
 * — which is all it ever did.
 *
 * The browser posts what the playground actually holds (a prompt form, its
 * variables, the conversation so far) rather than a workflow. Building the
 * workflow server-side keeps the engine's input off the wire, and keeps the
 * `{{input}}` binding rules in one tested place.
 *
 * Built on `@langwatch/api` as its first RPC endpoint, session-authenticated
 * on `prompts:view` — matching the access the playground has always had. The
 * session chain is deliberately middleware, not in-handler checks: the origin
 * gate runs first (the session cookie's only browser-side protection is
 * SameSite=Lax, which a sibling subdomain slips past), then the session
 * resolve, then the project permission — all before validation, so an
 * unauthenticated caller learns nothing about the schema. It is deliberately
 * NOT the `/api/prompts` family: that one is the documented,
 * API-key-authenticated SDK surface, and this is a browser endpoint with no
 * stable contract, kept out of the published OpenAPI document.
 */
import { createService, type MountedRoute } from "@langwatch/api";
import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import type { MiddlewareHandler } from "hono";
import type { SSEStreamingApi } from "hono/streaming";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { InsufficientPermissionsError } from "~/app/api/middleware/org-auth";
import { studioBackendPostEvent } from "~/app/api/workflows/post_event/post-event";
import { env } from "~/env.mjs";
import {
  addEnvs,
  LlmModelNotSetError,
} from "~/optimization_studio/server/addEnvs";
import { loadDatasets } from "~/optimization_studio/server/loadDatasets";
import type {
  StudioClientEvent,
  StudioServerEvent,
} from "~/optimization_studio/types/events";
import {
  executeRequestSchema,
  PLAYGROUND_API_VERSION,
  type PlaygroundStreamEvent,
} from "~/prompts/prompt-playground/executeContract";
import { hasProjectPermission, isDemoProjectId } from "~/server/api/rbac";
import {
  credentialClassFor,
  familyFromBasePath,
  handlerManagedAuth,
  publicEndpoint,
  registerRoutePolicy,
} from "~/server/api/security";
import { getServerAuthSession } from "~/server/auth";
import { isAllowedAuthOrigin } from "~/server/better-auth/originGate";
import { DatasetNotReadyError } from "~/server/datasets/errors";
import { prisma } from "~/server/db";
import {
  buildPromptExecutionEvent,
  outputConfigsFor,
  PROMPT_NODE_ID,
} from "~/server/prompt-config/buildPromptExecutionEvent";
import { extractStreamableOutput } from "~/server/prompt-config/output-formatter";
import { parseLLMError } from "~/utils/formatLLMError";
import { captureException, toError } from "~/utils/posthogErrorCapture";
import { generateOtelTraceId } from "~/utils/trace";

const logger = createLogger("langwatch:prompt-playground");

const BASE_PATH = "/api/prompt-playground";

type PlaygroundSession = NonNullable<
  Awaited<ReturnType<typeof getServerAuthSession>>
>;

// ── failure modes ────────────────────────────────────────────────────────────

/** No session cookie, or an expired one. Signing in is the remediation. */
class MissingSessionError extends HandledError {
  declare readonly code: "missing_credentials";

  constructor() {
    super("missing_credentials", "Sign in to run prompts in the playground", {
      httpStatus: 401,
      fault: "customer",
    });
    this.name = "MissingSessionError";
  }
}

/**
 * A state-changing request whose Origin/Referer is not the app itself. The
 * session cookie rides along on such requests automatically, so they are
 * refused before the session is even read.
 */
class CrossOriginRefusedError extends HandledError {
  declare readonly code: "cross_origin_refused";

  constructor() {
    super(
      "cross_origin_refused",
      "This endpoint only accepts requests from the LangWatch app",
      { httpStatus: 403, fault: "customer" },
    );
    this.name = "CrossOriginRefusedError";
  }
}

/**
 * The one body field the permission check needs did not parse. Same code and
 * shape as the framework's own validation refusals, because that is what it
 * is — just raised before the schema runs.
 */
class ProjectIdInvalidError extends HandledError {
  declare readonly code: "schema_failure";

  constructor() {
    super("schema_failure", "projectId must be a string", {
      httpStatus: 422,
      fault: "customer",
      meta: {
        field: "projectId",
        type: "invalid_type",
        message: "projectId must be a string",
      },
    });
    this.name = "ProjectIdInvalidError";
  }
}

/** {@link LlmModelNotSetError}, spoken as the code the registry renders. */
class ModelNotSetError extends HandledError {
  declare readonly code: "llm_model_not_set";

  constructor() {
    super(
      "llm_model_not_set",
      "The prompt has no model selected. Pick a model in the editor.",
      { httpStatus: 422, fault: "customer" },
    );
    this.name = "ModelNotSetError";
  }
}

// ── access chain ─────────────────────────────────────────────────────────────

/**
 * Refuses state-changing requests from another origin before the session is
 * even read. The session cookie is attached by the browser automatically, and
 * `SameSite=Lax` is a site boundary, not an origin one.
 */
const requireSameOrigin: MiddlewareHandler = async (c, next) => {
  const allowed = isAllowedAuthOrigin({
    method: c.req.method,
    origin: c.req.header("origin"),
    referer: c.req.header("referer"),
    baseUrl: env.NEXTAUTH_URL,
  });
  if (!allowed) {
    // The detail lives in the log, not the response: a misconfigured
    // NEXTAUTH_URL and a real cross-site POST must be tellable apart somewhere.
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
  await next();
};

/** Resolves the browser session, refusing anonymous callers with a code. */
const sessionAuth: MiddlewareHandler = async (c, next) => {
  const session = await getServerAuthSession({ req: c.req.raw });
  if (!session) {
    throw new MissingSessionError();
  }
  c.set("session", session);
  await next();
};

const projectIdShape = z.string().min(1).max(64);

/**
 * Checks `prompts:view` against the project the request names.
 *
 * Runs before validation, so the body is read raw (Hono caches the parse; the
 * validator behind it re-reads the cache, not the stream) and the one field it
 * needs is parsed through its own bounded shape — a crafted `projectId` must
 * be a refusal, never a Prisma error on the auth path.
 *
 * The demo project is refused outright: its blanket `prompts:view` grant to
 * every signed-in user is a *view* grant, and execution spends provider
 * credit — the instance's own keys when the project sets none.
 */
const requirePromptsViewOnProject: MiddlewareHandler = async (c, next) => {
  const body = (await c.req.json().catch(() => null)) as {
    projectId?: unknown;
  } | null;
  const parsed = projectIdShape.safeParse(body?.projectId);
  if (!parsed.success) {
    throw new ProjectIdInvalidError();
  }
  const projectId = parsed.data;

  const session = c.get("session") as PlaygroundSession;
  const permitted =
    !isDemoProjectId(projectId) &&
    (await hasProjectPermission(
      { prisma, session },
      projectId,
      "prompts:view",
    ));
  if (!permitted) {
    throw new InsufficientPermissionsError("prompts:view");
  }
  await next();
};

// ── route policy registration ────────────────────────────────────────────────

const family = familyFromBasePath(BASE_PATH);

const playgroundPolicy = () =>
  handlerManagedAuth({
    reason:
      "browser session resolved by the service auth middleware behind an " +
      "origin gate; prompts:view checked against the body's projectId by " +
      "endpoint middleware, with the demo project refused because execution " +
      "spends provider credit",
    permissions: ["prompts:view"],
    credential: "session",
  });

function registerMountedRoute(route: MountedRoute): void {
  const policy = route.isNamespaceGuard
    ? publicEndpoint(
        "version-namespace guard: answers 404 for unknown version segments " +
          "so they cannot fall through to a dynamic unversioned route; " +
          "reads no data and takes no credential",
      )
    : playgroundPolicy();
  registerRoutePolicy({
    method: route.method,
    path: route.path,
    policy,
    family,
    credentialClass: credentialClassFor({ scope: "session", policy }),
  });
}

// ── streaming ────────────────────────────────────────────────────────────────

/**
 * The new text since the last chunk we sent.
 *
 * The engine reports the output field's whole current value on every state
 * change, so the delta is what has been appended. A value shorter than what we
 * already sent is a different field winning a race rather than the model
 * retracting what it said, so it is ignored.
 */
function deltaFrom({
  outputs,
  outputConfigs,
  alreadySent,
}: {
  outputs: Parameters<typeof extractStreamableOutput>[0];
  outputConfigs: Parameters<typeof extractStreamableOutput>[1];
  alreadySent: string;
}): { text: string; total: string } | undefined {
  const current = extractStreamableOutput(outputs, outputConfigs);
  if (current === undefined || current.length < alreadySent.length) {
    return undefined;
  }
  return { text: current.slice(alreadySent.length), total: current };
}

/**
 * Reads one engine event, sending whatever it means for the client.
 *
 * Returns true once the run is over, so the caller stops rather than the
 * handler having to reason about ordering.
 */
function handleEngineEvent({
  serverEvent,
  outputConfigs,
  sentSoFar,
  send,
}: {
  serverEvent: StudioServerEvent;
  outputConfigs: ReturnType<typeof outputConfigsFor>;
  sentSoFar: string;
  send: (event: PlaygroundStreamEvent) => void;
}): { sent: string; done: boolean } {
  if (serverEvent.type === "error") {
    throw new Error(serverEvent.payload?.message ?? "An error occurred");
  }

  if (serverEvent.type === "done") return { sent: sentSoFar, done: true };

  if (
    serverEvent.type !== "component_state_change" ||
    serverEvent.payload?.component_id !== PROMPT_NODE_ID
  ) {
    return { sent: sentSoFar, done: false };
  }

  const state = serverEvent.payload.execution_state;
  if (!state) return { sent: sentSoFar, done: false };

  const delta = deltaFrom({
    outputs: state.outputs,
    outputConfigs,
    alreadySent: sentSoFar,
  });
  if (delta?.text) send({ type: "delta", content: delta.text });

  if (state.error) throw new Error(state.error);

  return {
    sent: delta?.total ?? sentSoFar,
    done: state.status === "success",
  };
}

/** Runs one execution, reporting it on the SSE stream. */
async function streamPromptExecution({
  stream,
  projectId,
  preparedEvent,
  traceId,
  outputConfigs,
}: {
  stream: SSEStreamingApi;
  projectId: string;
  preparedEvent: StudioClientEvent;
  traceId: string;
  outputConfigs: ReturnType<typeof outputConfigsFor>;
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
    pendingWrites = pendingWrites.then(() =>
      stream.writeSSE({ data: JSON.stringify(event) }),
    );
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
    await studioBackendPostEvent({
      projectId,
      message: preparedEvent,
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
      error: parseLLMError(
        error instanceof Error ? error.message : String(error),
      ),
    });
  } finally {
    finish();
    await pendingWrites;
  }
}

// ── service wiring ───────────────────────────────────────────────────────────

export const app = createService({
  name: "prompt-playground",
  basePath: BASE_PATH,
  middleware: [requireSameOrigin],
  auth: sessionAuth,
  onRouteMounted: registerMountedRoute,
})
  .version(PLAYGROUND_API_VERSION, (v) => {
    v.rpc(
      "/prompt.execute",
      {
        docs: { hide: true },
        // The check is real but not expressible as a bare `permission`: it
        // also refuses the demo project, whose blanket `prompts:view` grant
        // is a *view* grant and execution spends provider credit. So the
        // endpoint declares self-managed access and runs the check itself,
        // matching the `handlerManagedAuth` policy registered above.
        noPermission: {
          reason:
            "prompts:view checked against the body's projectId by endpoint " +
            "middleware, with the demo project refused because execution " +
            "spends provider credit",
        },
        middleware: [requirePromptsViewOnProject],
        input: executeRequestSchema,
      },
      async (c, { input }) => {
        const { projectId, formValues, variables, messages, threadId } = input;

        // Allocated before anything that can throw: the error path streams
        // under the same id, so the conversation's trace affordance points at
        // the run that failed rather than at nothing (#853).
        const traceId = generateOtelTraceId();

        let preparedEvent;
        try {
          preparedEvent = await loadDatasets(
            await addEnvs(
              buildPromptExecutionEvent({
                formValues,
                messages,
                variables,
                traceId,
                threadId: threadId ?? traceId,
              }),
              projectId,
            ),
            projectId,
          );
        } catch (error) {
          // A dataset still normalising is a client precondition, not a
          // fault — and it is already a HandledError, so it rides through.
          if (error instanceof DatasetNotReadyError) throw error;
          // A node with no model is fixable in the editor, not a server fault.
          if (error instanceof LlmModelNotSetError) {
            throw new ModelNotSetError();
          }
          captureException(toError(error), { extra: { projectId } });
          throw error;
        }

        // hono's streamSSE sets the content type, cache and connection
        // headers but not this one, and a reverse proxy that buffers the
        // response would hold every event until the run finished — which is
        // indistinguishable from the engine not streaming at all. The app's
        // other SSE surface sets it for the same reason.
        c.header("X-Accel-Buffering", "no");

        return streamSSE(c, (stream) =>
          streamPromptExecution({
            stream,
            projectId,
            preparedEvent,
            traceId,
            outputConfigs: outputConfigsFor(formValues),
          }),
        );
      },
    );
  })
  .build();

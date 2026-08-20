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
 * Session-authenticated on `prompts:view`, matching the access the playground
 * has always had — a viewer can run a prompt here, and could before. It is
 * deliberately NOT the `/api/prompts` family: that one is the documented,
 * API-key-authenticated SDK surface, and this is a browser endpoint with no
 * stable contract.
 */
import { createLogger } from "@langwatch/observability";
import type { SSEStreamingApi } from "hono/streaming";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { studioBackendPostEvent } from "~/app/api/workflows/post_event/post-event";
import {
  addEnvs,
  LlmModelNotSetError,
} from "~/optimization_studio/server/addEnvs";
import { loadDatasets } from "~/optimization_studio/server/loadDatasets";
import type {
  StudioClientEvent,
  StudioServerEvent,
} from "~/optimization_studio/types/events";
import { formSchema } from "~/prompts/schemas";
import { runtimeInputsSchema } from "~/prompts/schemas/field-schemas";
import { hasProjectPermission } from "~/server/api/rbac";
import { createServiceApp, handlerManagedAuth } from "~/server/api/security";
import { validator as zValidator } from "~/server/api/validation";
import { getServerAuthSession } from "~/server/auth";
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

const secured = createServiceApp({ basePath: "/api/prompt-playground" });

const executeRequestSchema = z.object({
  projectId: z.string(),
  formValues: formSchema,
  variables: runtimeInputsSchema.default([]),
  messages: z
    .array(z.object({ role: z.string(), content: z.string() }))
    .default([]),
  threadId: z.string().optional(),
});

/**
 * One event on the playground's stream.
 *
 * A closed set, rather than the previous arrangement where a failure was a text
 * message whose content began with the literal string `[ERROR]` and the client
 * string-matched it back apart.
 */
export type PlaygroundStreamEvent =
  | { type: "start"; messageId: string; traceId: string }
  | { type: "delta"; content: string }
  | { type: "error"; error: ReturnType<typeof parseLLMError> }
  | { type: "done" };

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

  const send = (event: PlaygroundStreamEvent) =>
    void stream.writeSSE({ data: JSON.stringify(event) });

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
  }
}

secured
  .access(
    handlerManagedAuth({
      reason: "user session validated in-handler via getServerAuthSession",
      permissions: ["prompts:view"],
      credential: "session",
    }),
  )
  .post("/execute", zValidator("json", executeRequestSchema), async (c) => {
    const { projectId, formValues, variables, messages, threadId } =
      c.req.valid("json");

    const session = await getServerAuthSession({ req: c.req.raw as any });
    if (!session) {
      return c.json(
        { error: "You must be logged in to access this endpoint." },
        { status: 401 },
      );
    }

    const hasPermission = await hasProjectPermission(
      { prisma, session },
      projectId,
      "prompts:view",
    );
    if (!hasPermission) {
      return c.json(
        { error: "You do not have permission to access this endpoint." },
        { status: 403 },
      );
    }

    // Allocated before anything that can throw: the error path streams under
    // the same id, so the conversation's trace affordance points at the run
    // that failed rather than at nothing (#853).
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
      // A dataset still normalising is a client precondition, not a fault.
      if (error instanceof DatasetNotReadyError) {
        return c.json({ error: error.message }, { status: 425 });
      }
      // A node with no model is fixable in the editor, not a server fault.
      if (error instanceof LlmModelNotSetError) {
        return c.json(
          { error: error.message, cause: error.cause },
          { status: 422 },
        );
      }
      logger.error({ error, projectId }, "failed preparing prompt execution");
      captureException(toError(error), { extra: { projectId } });
      return c.json({ error: (error as Error).message }, { status: 500 });
    }

    return streamSSE(c, (stream) =>
      streamPromptExecution({
        stream,
        projectId,
        preparedEvent,
        traceId,
        outputConfigs: outputConfigsFor(formValues),
      }),
    );
  });

export const app = secured.hono;

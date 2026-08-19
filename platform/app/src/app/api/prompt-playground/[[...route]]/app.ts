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
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { studioBackendPostEvent } from "~/app/api/workflows/post_event/post-event";
import {
  addEnvs,
  LlmModelNotSetError,
} from "~/optimization_studio/server/addEnvs";
import { loadDatasets } from "~/optimization_studio/server/loadDatasets";
import type { StudioServerEvent } from "~/optimization_studio/types/events";
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

    const outputConfigs = outputConfigsFor(formValues);

    return streamSSE(c, async (stream) => {
      let aborted = false;
      stream.onAbort(() => {
        aborted = true;
      });

      const send = (event: PlaygroundStreamEvent) =>
        stream.writeSSE({ data: JSON.stringify(event) });

      let lastOutput = "";
      let finished = false;

      const finish = async () => {
        if (finished) return;
        finished = true;
        await send({ type: "done" });
      };

      await send({ type: "start", messageId: traceId, traceId });

      try {
        await studioBackendPostEvent({
          projectId,
          message: preparedEvent,
          isAborted: () => Promise.resolve(aborted),
          onEvent: (serverEvent: StudioServerEvent) => {
            if (
              serverEvent.type === "component_state_change" &&
              serverEvent.payload?.component_id === PROMPT_NODE_ID
            ) {
              const state = serverEvent.payload.execution_state;
              if (!state) return;

              const current = extractStreamableOutput(
                state.outputs,
                outputConfigs,
              );
              // Only ever grows; a shorter value is a different field winning a
              // race, not the model retracting what it already said.
              if (
                current !== undefined &&
                current.length >= lastOutput.length
              ) {
                const delta = current.slice(lastOutput.length);
                if (delta) void send({ type: "delta", content: delta });
                lastOutput = current;
              }

              if (state.error) throw new Error(state.error);
              if (state.status === "success") void finish();
              return;
            }

            if (serverEvent.type === "error") {
              throw new Error(
                serverEvent.payload?.message ?? "An error occurred",
              );
            }

            if (serverEvent.type === "done") void finish();
          },
        });
      } catch (error) {
        logger.error({ error, projectId }, "prompt execution failed");
        await send({
          type: "error",
          error: parseLLMError(
            error instanceof Error ? error.message : String(error),
          ),
        });
      } finally {
        await finish();
      }
    });
  });

export const app = secured.hono;

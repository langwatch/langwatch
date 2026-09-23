import { randomBytes } from "node:crypto";

import type { AuthzApi } from "@langwatch/authz-contract";
import { createLogger } from "@langwatch/observability";
import {
  parseLLMError,
  PromptPlaygroundNotPermittedError,
  type PlaygroundStreamEvent,
  type PromptExecuteRequest,
} from "@langwatch/prompt-contract";
import {
  LlmModelNotSetError,
  type WorkflowApi,
  type StudioServerEvent,
  type StudioClientEvent,
} from "@langwatch/workflow-contract";

import {
  buildPromptExecutionEvent,
  outputConfigsFor,
} from "../rules/prompt-execution-event.rules.ts";
import { handleEngineEvent } from "../rules/prompt-execution-stream.rules.ts";
import type { PromptExecuteBoundsService } from "./prompt-execute-bounds.service.ts";

const logger = createLogger("langwatch:prompt-playground");

/** The handled CODE an error carries, or nothing. */
function findHandledCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const code = (error as { code: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function executionEvents(
  run: (send: (event: PlaygroundStreamEvent) => void, isAborted: () => boolean) => Promise<void>,
): AsyncIterable<PlaygroundStreamEvent> {
  let aborted = false;
  const stream = new ReadableStream<PlaygroundStreamEvent>({
    async start(controller) {
      const send = (event: PlaygroundStreamEvent) => {
        if (aborted) return;
        try {
          controller.enqueue(event);
        } catch {
          aborted = true;
        }
      };
      try {
        await run(send, () => aborted);
      } finally {
        if (!aborted) controller.close();
      }
    },
    cancel() {
      aborted = true;
    },
  });

  return {
    async *[Symbol.asyncIterator]() {
      const reader = stream.getReader();
      try {
        for (;;) {
          const next = await reader.read();
          if (next.done) return;
          yield next.value;
        }
      } finally {
        await reader.cancel();
        reader.releaseLock();
      }
    },
  };
}

/** Runs one execution, reporting it on the SSE stream. */
async function streamPromptExecution({
  send,
  projectId,
  preparedEvent,
  traceId,
  outputConfigs,
  workflow,
}: {
  send: (event: PlaygroundStreamEvent) => void;
  projectId: string;
  preparedEvent: StudioClientEvent;
  traceId: string;
  outputConfigs: ReturnType<typeof outputConfigsFor>;
  workflow: WorkflowApi;
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
    await workflow.postStudioEvent({
      projectId,
      event: preparedEvent,
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

export class PromptExecutionService {
  readonly #workflow: WorkflowApi;
  readonly #authz: AuthzApi;
  readonly #bounds: PromptExecuteBoundsService;

  private constructor(input: {
    workflow: WorkflowApi;
    authz: AuthzApi;
    bounds: PromptExecuteBoundsService;
  }) {
    this.#workflow = input.workflow;
    this.#authz = input.authz;
    this.#bounds = input.bounds;
  }

  static create(input: {
    workflow: WorkflowApi;
    authz: AuthzApi;
    bounds: PromptExecuteBoundsService;
  }): PromptExecutionService {
    return new PromptExecutionService(input);
  }

  async execute(input: PromptExecuteRequest): Promise<AsyncIterable<PlaygroundStreamEvent>> {
    const { projectId, formValues, variables, messages, threadId } = input;

    if (this.#authz.isDemoProject({ projectId })) throw new PromptPlaygroundNotPermittedError();

    // Counted after the permission probe: a caller without standing never
    // reaches the budget, and a refused caller never spends it.
    await this.#bounds.assertExecuteWithinBounds({ projectId, messageCount: messages.length });

    // Allocated before anything that can throw: the error path streams under
    // the same id, so the conversation's trace affordance points at the run
    // that failed rather than at nothing (#853).
    const traceId = randomBytes(16).toString("hex");

    let preparedEvent: StudioClientEvent;
    try {
      preparedEvent = await this.#workflow.prepareStudioEvent({
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
        throw error;
      }
      logger.error({ error, projectId }, "could not prepare a playground run");
      this.#workflow.reportStudioFailure(error, { projectId });
      throw error;
    }

    return executionEvents((send) =>
      streamPromptExecution({
        send,
        projectId,
        preparedEvent,
        traceId,
        outputConfigs: outputConfigsFor(formValues),
        workflow: this.#workflow,
      }),
    );
  }
}

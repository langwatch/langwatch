/**
 * A clustering run whose model serves coding-assistant surfaces only
 * (specs/model-providers/codex-account-provider.feature): the customer can fix
 * it, so the run records a code the UI explains and it logs as routine.
 */
import type { IntentContext } from "@langwatch/eventing";
import {
  ModelRestrictedForExecutionError,
  ModelRestrictedForFeatureError,
} from "@langwatch/model-provider-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  classifyClusteringError,
  createTopicClusteringRunHandler,
} from "../topic-clustering.intent.ts";

const logger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn(),
}));
vi.mock("@langwatch/observability", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createLogger: () => logger,
}));

const CODEX_MODEL = "openai_codex/gpt-5.6-terra";

const context: IntentContext = {
  processName: "topicClustering",
  projectId: "project-1",
  processKey: "project-1",
  tenantId: "project-1",
  messageKey: "process:project-1:run:20260717:page-1",
  attempt: 1,
};

function runWith(error: Error) {
  const commands = {
    recordClusteringRunStarted: vi.fn().mockResolvedValue(undefined),
    recordClusteringRunCompleted: vi.fn().mockResolvedValue(undefined),
    recordClusteringRunFailed: vi.fn().mockResolvedValue(undefined),
  };
  const runClusteringPage = vi.fn().mockRejectedValue(error);
  const run = createTopicClusteringRunHandler({
    runPort: { runClusteringPage },
    commands,
    classifyError: classifyClusteringError,
    metrics: { incrementPageTotal: vi.fn(), observePageDuration: vi.fn() },
    clock: () => 999,
  });

  return {
    commands,
    runClusteringPage,
    run: () => run({ runId: "20260717", page: 1, searchAfter: null }, context),
  };
}

const refusals: [string, () => Error][] = [
  [
    "at execution",
    () => new ModelRestrictedForExecutionError({ model: CODEX_MODEL, provider: null }),
  ],
  [
    "at model selection",
    () =>
      new ModelRestrictedForFeatureError({
        featureKey: "analytics.topic_clustering_llm",
        role: "FAST",
        featureDisplayName: "Topic clustering",
        projectId: "project-1",
        restrictedModels: [CODEX_MODEL],
      }),
  ],
];

describe("topic clustering with a coding-assistant-only model", () => {
  beforeEach(() => {
    logger.warn.mockClear();
    logger.error.mockClear();
  });

  describe.each(refusals)("when the model is refused %s", (_, refusal) => {
    /** @scenario "A refused Codex clustering model logs as a customer setup issue" */
    it("classifies the refusal as the customer's to fix", () => {
      expect(classifyClusteringError(refusal())).toEqual({
        code: "model_restricted",
        isUserActionable: true,
      });
    });

    /** @scenario "A refused Codex clustering model logs as a customer setup issue" */
    it("logs at warn, never at error", async () => {
      await runWith(refusal()).run();

      expect(logger.warn).toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    });

    /** @scenario "A clustering run refused for its Codex model is recorded as failed" */
    it("records the run as failed with the restriction's code, without retrying", async () => {
      const { run, runClusteringPage, commands } = runWith(refusal());

      await expect(run()).resolves.toBeUndefined();

      expect(runClusteringPage).toHaveBeenCalledTimes(1);
      expect(commands.recordClusteringRunFailed).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: "20260717",
          errorCode: "model_restricted",
          isUserActionable: true,
        }),
      );
    });
  });
});

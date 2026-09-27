import { createTenantId } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

import { ExecuteEvaluationCommand } from "../../eventing/evaluation-execution.intent.ts";
import { EvaluationProcessingProducerService } from "../evaluation-processing-producer.service.ts";
import { createEvaluationProcessingPipeline } from "../evaluation-processing.service.ts";

/** The producer's definition, as a host receives it. */
const producer = () =>
  EvaluationProcessingProducerService.create({ processName: "langwatch-api" }).build();

/** The consumer's, built from stores and handlers a caller would supply. */
const consumer = () =>
  createEvaluationProcessingPipeline({
    evalRunStore: { store: async () => undefined, get: async () => ({ kind: "empty" }) },
    evaluationAnalyticsStore: {
      store: async () => undefined,
      get: async () => ({ kind: "empty" }),
    },
    evaluationAnalyticsRollupAppendStore: { append: async () => undefined },
    executeEvaluationCommand: ExecuteEvaluationCommand.create({
      execute: () => Promise.reject(new Error("not executed in this test")),
    }),
    automations: {
      handleEvaluationTriggerMatch: async () => undefined,
      handleEvaluationGraphTriggerActivity: async () => undefined,
    },
  });

describe("given a process that only SENDS evaluation commands", () => {
  it("builds the same pipeline the consumer registers, not a producer's subset", () => {
    const names = (definition: { metadata: { commands: readonly { name: string }[] } }) =>
      definition.metadata.commands.map((command) => command.name).toSorted();

    expect(producer().metadata.name).toBe("evaluation_processing");
    // One definition, two registrations. The routing triple a job carries is
    // derived from these names, so a fork here sends work the worker's own
    // registry does not claim.
    expect(names(producer())).toEqual(names(consumer()));
  });

  describe("when a stand-in is reached anyway", () => {
    it("refuses by name instead of reporting a write that never happened", async () => {
      const [projection] = [...producer().foldProjections.values()];

      await expect(
        projection!.open((fold) =>
          fold.store.store(fold.init(), {
            aggregateId: "evaluation-1",
            tenantId: createTenantId("project-1"),
          }),
        ),
      ).rejects.toThrow(
        /langwatch-api registered the evaluation_processing pipeline as a producer only/,
      );
    });
  });
});

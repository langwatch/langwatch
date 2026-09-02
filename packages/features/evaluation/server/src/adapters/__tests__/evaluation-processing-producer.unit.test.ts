import { describe, expect, it } from "vitest";
import { createEvaluationProcessingProducerPipeline } from "../evaluation-processing-producer.adapter";
import { createEvaluationProcessingPipeline } from "../evaluation-processing.adapter";

/** The producer's definition, as a host receives it. */
const producer = () =>
  createEvaluationProcessingProducerPipeline({ processName: "langwatch-api" }) as unknown as {
    metadata: { name: string; commands: ReadonlyArray<{ name: string }> };
    foldProjections: Map<string, { definition: { store: { store(state: unknown, context: unknown): Promise<void> } } }>;
  };

/** The consumer's, built from stores and handlers a caller would supply. */
const consumer = () =>
  createEvaluationProcessingPipeline({
    evalRunStore: { store: async () => undefined, get: async () => null },
    evaluationAnalyticsStore: { store: async () => undefined, get: async () => null },
    evaluationAnalyticsRollupAppendStore: { append: async () => undefined },
    executeEvaluationCommand: { handle: async () => [] },
    automations: {
      handleEvaluationTriggerMatch: async () => undefined,
      handleEvaluationGraphTriggerActivity: async () => undefined,
    },
  } as never) as unknown as {
    metadata: { name: string; commands: ReadonlyArray<{ name: string }> };
  };

describe("given a process that only SENDS evaluation commands", () => {
  it("builds the same pipeline the consumer registers, not a producer's subset", () => {
    const names = (definition: { metadata: { commands: ReadonlyArray<{ name: string }> } }) =>
      definition.metadata.commands.map((command) => command.name).sort();

    expect(producer().metadata.name).toBe("evaluation_processing");
    // One definition, two registrations. The routing triple a job carries is
    // derived from these names, so a fork here sends work the worker's own
    // registry does not claim.
    expect(names(producer())).toEqual(names(consumer()));
  });

  describe("when a stand-in is reached anyway", () => {
    it("refuses by name instead of reporting a write that never happened", async () => {
      const [projection] = [...producer().foldProjections.values()];

      await expect(projection!.definition.store.store({}, {})).rejects.toThrow(
        /langwatch-api registered the evaluation_processing pipeline as a producer only/,
      );
    });
  });
});

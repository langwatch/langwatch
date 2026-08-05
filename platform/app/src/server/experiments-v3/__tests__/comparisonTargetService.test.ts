import { HandledError } from "@langwatch/handled-error";
import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import type { DatasetReference, TargetConfig } from "~/experiments-v3/types";
import { AgentNotFoundError } from "~/server/agents/errors";
import { attachComparison } from "../comparisonTargetService";

/**
 * The handled error `work` rejected with, for a test to assert on. Tests assert
 * the `code` rather than the sentence: the code is the contract every caller
 * branches on, the sentence is copy.
 */
const rejectionOf = async (work: Promise<unknown>): Promise<HandledError> => {
  const error: unknown = await work.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  if (!HandledError.isHandled(error)) {
    throw new Error(`expected a handled error, got: ${String(error)}`);
  }
  return error;
};

const dataset = (): DatasetReference => ({
  id: "dataset-1",
  name: "Test Dataset",
  type: "inline",
  columns: [
    { id: "input", name: "input", type: "string" },
    { id: "expected_output", name: "expected_output", type: "string" },
  ],
});

const promptTarget = (id: string): TargetConfig => ({
  id,
  type: "prompt",
  promptId: `prompt-${id}`,
  inputs: [{ identifier: "input", type: "str" }],
  outputs: [{ identifier: "output", type: "str" }],
  mappings: {
    "dataset-1": {
      input: {
        type: "source",
        source: "dataset",
        sourceId: "dataset-1",
        sourceField: "input",
      },
    },
  },
});

const fakePromptService = (
  prompts: Record<string, { id: string; version: number; versionId: string }>,
) => ({
  getPromptByIdOrHandle: async ({ idOrHandle }: { idOrHandle: string }) => {
    const found = prompts[idOrHandle];
    if (!found) return null;
    return {
      ...found,
      inputs: [{ identifier: "input", type: "str" }],
      outputs: [{ identifier: "output", type: "str" }],
    } as never;
  },
});

const fakeAgentService = (
  agents: Record<string, { id: string; type: string; config: unknown }>,
) => ({
  getByIdOrThrow: async ({ id }: { id: string }) => {
    const found = agents[id];
    if (!found) throw new AgentNotFoundError();
    return found as never;
  },
});

const fakeEvaluatorService = () => {
  let created: { id: string; config: unknown } | undefined;
  return {
    getAllWithFields: async () =>
      created
        ? [
            {
              ...created,
              fields: [{ identifier: "candidates", type: "str" }],
              outputFields: [{ identifier: "label", type: "str" }],
            } as never,
          ]
        : [],
    createWithDefaults: async (input: { id: string; config: unknown }) => {
      created = { id: input.id, config: input.config };
      return created as never;
    },
    enrichWithFields: async (evaluator: { id: string; config: unknown }) =>
      ({
        ...evaluator,
        fields: [{ identifier: "candidates", type: "str" }],
        outputFields: [{ identifier: "label", type: "str" }],
      }) as never,
  };
};

describe("attachComparison()", () => {
  const basePrisma = {} as PrismaClient;

  describe("when both variants already exist as targets", () => {
    /** @scenario "Attach a comparison to two targets that already exist" */
    it("adds one comparison target referencing both, creating nothing new", async () => {
      const targets = [promptTarget("target-a"), promptTarget("target-b")];

      const result = await attachComparison({
        prisma: basePrisma,
        projectId: "project-1",
        targets,
        datasets: [dataset()],
        activeDatasetId: "dataset-1",
        body: {
          variants: [
            { kind: "existingTarget", targetId: "target-a" },
            { kind: "existingTarget", targetId: "target-b" },
          ],
        },
        services: {
          evaluatorService: fakeEvaluatorService(),
        },
      });

      expect(result.createdTargetIds).toEqual([]);
      expect(result.reusedTargetIds).toEqual([]);
      expect(result.targets).toHaveLength(3);
      const comparisonTarget = result.targets.find(
        (t) => t.id === result.comparisonTargetId,
      )!;
      expect(comparisonTarget.comparison?.variants.sort()).toEqual([
        "target-a",
        "target-b",
      ]);
    });
  });

  describe("when a prompt variant is already a target in the experiment", () => {
    /** @scenario "A prompt variant reuses its existing target instead of duplicating it" */
    it("reuses the existing target instead of creating a duplicate", async () => {
      const existing = promptTarget("target-a");
      existing.promptId = "prompt-draft-v1";

      const result = await attachComparison({
        prisma: basePrisma,
        projectId: "project-1",
        targets: [existing, promptTarget("target-b")],
        datasets: [dataset()],
        activeDatasetId: "dataset-1",
        body: {
          variants: [
            { kind: "prompt", handle: "draft-v1" },
            { kind: "existingTarget", targetId: "target-b" },
          ],
        },
        services: {
          promptService: fakePromptService({
            "draft-v1": {
              id: "prompt-draft-v1",
              version: 1,
              versionId: "v1",
            },
          }),
          evaluatorService: fakeEvaluatorService(),
        },
      });

      expect(result.createdTargetIds).toEqual([]);
      expect(result.reusedTargetIds).toEqual(["target-a"]);
      expect(result.targets).toHaveLength(3); // 2 existing targets + new comparison, no duplicate
    });
  });

  describe("when a variant references a prompt and an agent that don't exist yet as targets", () => {
    /** @scenario "Attach a comparison creating missing variant targets inline" */
    it("creates both targets inline and compares them", async () => {
      const result = await attachComparison({
        prisma: basePrisma,
        projectId: "project-1",
        targets: [],
        datasets: [dataset()],
        activeDatasetId: "dataset-1",
        body: {
          variants: [
            { kind: "prompt", handle: "draft-v1" },
            { kind: "agent", agentId: "agent-1" },
          ],
        },
        services: {
          promptService: fakePromptService({
            "draft-v1": {
              id: "prompt-draft-v1",
              version: 1,
              versionId: "v1",
            },
          }),
          agentService: fakeAgentService({
            "agent-1": {
              id: "agent-1",
              type: "code",
              config: {
                inputs: [{ identifier: "input", type: "str" }],
                outputs: [{ identifier: "output", type: "str" }],
              },
            },
          }),
          evaluatorService: fakeEvaluatorService(),
        },
      });

      expect(result.createdTargetIds).toHaveLength(2);
      expect(result.targets).toHaveLength(3); // 2 new variants + comparison
    });
  });

  describe("when fewer than two variants resolve", () => {
    /** @scenario "Rejects a variant that is itself a comparison" */
    it("rejects a variant that is itself a comparison", async () => {
      const comparisonTarget: TargetConfig = {
        ...promptTarget("verdict"),
        type: "evaluator",
        targetEvaluatorId: "evaluator-1",
        comparison: {
          variants: ["target-a", "target-b"],
          hasGoldenAnswer: false,
          includeMetrics: [],
          randomizeOrder: true,
        },
      };

      const error = await rejectionOf(
        attachComparison({
          prisma: basePrisma,
          projectId: "project-1",
          targets: [comparisonTarget, promptTarget("target-a")],
          datasets: [dataset()],
          activeDatasetId: "dataset-1",
          body: {
            variants: [
              { kind: "existingTarget", targetId: "verdict" },
              { kind: "existingTarget", targetId: "target-a" },
            ],
          },
          services: { evaluatorService: fakeEvaluatorService() },
        }),
      );
      expect(error.code).toBe("comparison_variant_is_comparison");
    });
  });

  describe("when an existingTarget reference does not exist", () => {
    /** @scenario "Unknown existing-target reference lists the current targets" */
    it("lists the current targets in the error", async () => {
      const error = await rejectionOf(
        attachComparison({
          prisma: basePrisma,
          projectId: "project-1",
          targets: [promptTarget("target-a"), promptTarget("target-b")],
          datasets: [dataset()],
          activeDatasetId: "dataset-1",
          body: {
            variants: [
              { kind: "existingTarget", targetId: "does-not-exist" },
              { kind: "existingTarget", targetId: "target-a" },
            ],
          },
          services: { evaluatorService: fakeEvaluatorService() },
        }),
      );
      expect(error.code).toBe("comparison_variant_target_not_found");

      expect(error.meta.availableTargets).toEqual([
        { id: "target-a", type: "prompt" },
        { id: "target-b", type: "prompt" },
      ]);
    });
  });

  describe("when a created agent target's required input has no matching dataset column", () => {
    /** @scenario "Rejects a variant whose input cannot be mapped to the dataset" */
    it("fails fast instead of persisting an unrunnable target", async () => {
      const error = await rejectionOf(
        attachComparison({
          prisma: basePrisma,
          projectId: "project-1",
          targets: [promptTarget("target-a")],
          datasets: [dataset()],
          activeDatasetId: "dataset-1",
          body: {
            variants: [
              { kind: "existingTarget", targetId: "target-a" },
              { kind: "agent", agentId: "agent-1" },
            ],
          },
          services: {
            agentService: fakeAgentService({
              "agent-1": {
                id: "agent-1",
                type: "code",
                config: {
                  inputs: [{ identifier: "thread_history", type: "str" }],
                  outputs: [{ identifier: "output", type: "str" }],
                },
              },
            }),
            evaluatorService: fakeEvaluatorService(),
          },
        }),
      );
      expect(error.code).toBe("comparison_variant_unmappable");

      expect(error.meta.fields).toEqual(["thread_history"]);
    });
  });

  describe("when hasGoldenAnswer is true but no golden field is given", () => {
    it("rejects with a clear error", async () => {
      const error = await rejectionOf(
        attachComparison({
          prisma: basePrisma,
          projectId: "project-1",
          targets: [promptTarget("target-a"), promptTarget("target-b")],
          datasets: [dataset()],
          activeDatasetId: "dataset-1",
          body: {
            variants: [
              { kind: "existingTarget", targetId: "target-a" },
              { kind: "existingTarget", targetId: "target-b" },
            ],
            hasGoldenAnswer: true,
          },
          services: { evaluatorService: fakeEvaluatorService() },
        }),
      );
      expect(error.code).toBe("comparison_golden_field_required");
    });
  });

  describe("when goldenField does not match a real dataset column", () => {
    it("rejects rather than persisting a mapping to nothing", async () => {
      const error = await rejectionOf(
        attachComparison({
          prisma: basePrisma,
          projectId: "project-1",
          targets: [promptTarget("target-a"), promptTarget("target-b")],
          datasets: [dataset()],
          activeDatasetId: "dataset-1",
          body: {
            variants: [
              { kind: "existingTarget", targetId: "target-a" },
              { kind: "existingTarget", targetId: "target-b" },
            ],
            goldenField: "exptected_outputt",
          },
          services: { evaluatorService: fakeEvaluatorService() },
        }),
      );
      expect(error.code).toBe("comparison_field_not_in_dataset");
    });
  });

  describe("when inputField does not match a real dataset column", () => {
    it("rejects rather than persisting a mapping to nothing", async () => {
      const error = await rejectionOf(
        attachComparison({
          prisma: basePrisma,
          projectId: "project-1",
          targets: [promptTarget("target-a"), promptTarget("target-b")],
          datasets: [dataset()],
          activeDatasetId: "dataset-1",
          body: {
            variants: [
              { kind: "existingTarget", targetId: "target-a" },
              { kind: "existingTarget", targetId: "target-b" },
            ],
            inputField: "not-a-real-column",
          },
          services: { evaluatorService: fakeEvaluatorService() },
        }),
      );
      expect(error.code).toBe("comparison_field_not_in_dataset");
    });
  });

  describe("when includeMetrics has duplicate entries", () => {
    it("dedupes them", async () => {
      const result = await attachComparison({
        prisma: basePrisma,
        projectId: "project-1",
        targets: [promptTarget("target-a"), promptTarget("target-b")],
        datasets: [dataset()],
        activeDatasetId: "dataset-1",
        body: {
          variants: [
            { kind: "existingTarget", targetId: "target-a" },
            { kind: "existingTarget", targetId: "target-b" },
          ],
          includeMetrics: ["cost", "cost", "duration"],
        },
        services: { evaluatorService: fakeEvaluatorService() },
      });

      const comparisonTarget = result.targets.find(
        (t) => t.id === result.comparisonTargetId,
      )!;
      expect(comparisonTarget.comparison?.includeMetrics).toEqual([
        "cost",
        "duration",
      ]);
    });
  });

  describe("when an agent variant references an agent that doesn't exist", () => {
    it("rejects with a clean 404-style error, not a generic failure", async () => {
      const error = await rejectionOf(
        attachComparison({
          prisma: basePrisma,
          projectId: "project-1",
          targets: [promptTarget("target-a")],
          datasets: [dataset()],
          activeDatasetId: "dataset-1",
          body: {
            variants: [
              { kind: "existingTarget", targetId: "target-a" },
              { kind: "agent", agentId: "does-not-exist" },
            ],
          },
          services: {
            agentService: fakeAgentService({}),
            evaluatorService: fakeEvaluatorService(),
          },
        }),
      );
      expect(error.code).toBe("comparison_variant_agent_not_found");

      expect(error.httpStatus).toBe(404);
      expect(error.meta.agentId).toBe("does-not-exist");
    });
  });

  describe("when the experiment has no dataset configured", () => {
    /** @scenario "Rejects an experiment with no dataset to compare against" */
    it("rejects rather than building an unrunnable comparison", async () => {
      const error = await rejectionOf(
        attachComparison({
          prisma: basePrisma,
          projectId: "project-1",
          targets: [promptTarget("target-a"), promptTarget("target-b")],
          datasets: [],
          activeDatasetId: "dataset-1",
          body: {
            variants: [
              { kind: "existingTarget", targetId: "target-a" },
              { kind: "existingTarget", targetId: "target-b" },
            ],
          },
          services: { evaluatorService: fakeEvaluatorService() },
        }),
      );
      expect(error.code).toBe("experiment_dataset_missing");
    });
  });

  describe("when two --variant specs resolve to the same underlying target", () => {
    it("rejects an explicit duplicate existingTarget reference", async () => {
      const error = await rejectionOf(
        attachComparison({
          prisma: basePrisma,
          projectId: "project-1",
          targets: [promptTarget("target-a"), promptTarget("target-b")],
          datasets: [dataset()],
          activeDatasetId: "dataset-1",
          body: {
            variants: [
              { kind: "existingTarget", targetId: "target-a" },
              { kind: "existingTarget", targetId: "target-a" },
            ],
          },
          services: { evaluatorService: fakeEvaluatorService() },
        }),
      );
      expect(error.code).toBe("comparison_variants_not_distinct");
    });

    it("rejects when a prompt: spec resolves to the same target as an existingTarget: spec", async () => {
      const existing = promptTarget("target-a");
      existing.promptId = "prompt-draft-v1";

      const error = await rejectionOf(
        attachComparison({
          prisma: basePrisma,
          projectId: "project-1",
          targets: [existing],
          datasets: [dataset()],
          activeDatasetId: "dataset-1",
          body: {
            variants: [
              { kind: "existingTarget", targetId: "target-a" },
              { kind: "prompt", handle: "draft-v1" },
            ],
          },
          services: {
            promptService: fakePromptService({
              "draft-v1": {
                id: "prompt-draft-v1",
                version: 1,
                versionId: "v1",
              },
            }),
            evaluatorService: fakeEvaluatorService(),
          },
        }),
      );
      expect(error.code).toBe("comparison_variants_not_distinct");
    });
  });

  describe("when three or more variants are given", () => {
    it("builds an N-way comparison, not just a pairwise one", async () => {
      const result = await attachComparison({
        prisma: basePrisma,
        projectId: "project-1",
        targets: [
          promptTarget("target-a"),
          promptTarget("target-b"),
          promptTarget("target-c"),
        ],
        datasets: [dataset()],
        activeDatasetId: "dataset-1",
        body: {
          variants: [
            { kind: "existingTarget", targetId: "target-a" },
            { kind: "existingTarget", targetId: "target-b" },
            { kind: "existingTarget", targetId: "target-c" },
          ],
        },
        services: { evaluatorService: fakeEvaluatorService() },
      });

      const comparisonTarget = result.targets.find(
        (t) => t.id === result.comparisonTargetId,
      )!;
      expect(comparisonTarget.comparison?.variants.sort()).toEqual([
        "target-a",
        "target-b",
        "target-c",
      ]);
    });
  });
});

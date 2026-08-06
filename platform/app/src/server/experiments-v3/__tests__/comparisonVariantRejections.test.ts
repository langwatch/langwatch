/**
 * The variant specs a comparison refuses, and the code each refusal carries.
 *
 * Driven through `attachComparison` because that is the public entry point;
 * the behaviour under test lives in `comparisonVariants.ts`.
 */
import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import type { TargetConfig } from "~/experiments-v3/types";
import { attachComparison } from "../comparisonTargetService";
import {
  dataset,
  fakeAgentService,
  fakeEvaluatorService,
  fakePromptService,
  promptTarget,
  rejectionOf,
} from "./fixtures/comparisonFixtures";

describe("attachComparison() variant rejections", () => {
  const basePrisma = {} as PrismaClient;

  describe("when a variant is itself a comparison", () => {
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

  describe("when two --variant specs resolve to the same underlying target", () => {
    /** @scenario "Rejects variants that all resolve to the same target" */
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
});

/**
 * How a comparison's `--variant` specs become experiment targets: which are
 * reused, which are created, and which are refused.
 *
 * Driven through `attachComparison` because that is the public entry point;
 * the behaviour under test lives in `comparisonVariants.ts`.
 */
import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { attachComparison } from "../comparisonTargetService";
import {
  dataset,
  fakeAgentService,
  fakeEvaluatorService,
  fakePromptService,
  promptTarget,
} from "./fixtures/comparisonFixtures";

describe("attachComparison() variant resolution", () => {
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

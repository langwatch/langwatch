/**
 * How a comparison's own configuration is validated once its variants have
 * resolved: the fields it judges on, the dataset they must exist in, and the
 * metrics it carries.
 */
import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { attachComparison } from "../comparisonTargetService";
import {
  dataset,
  fakeEvaluatorService,
  promptTarget,
  rejectionOf,
} from "./fixtures/comparisonFixtures";

describe("attachComparison() comparison configuration", () => {
  const basePrisma = {} as PrismaClient;

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
    /** @scenario "Rejects a golden field that is not a dataset column" */
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
});

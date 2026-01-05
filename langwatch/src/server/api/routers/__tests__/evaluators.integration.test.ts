/**
 * @vitest-environment node
 *
 * Integration tests for Evaluators tRPC endpoints.
 * Tests the actual CRUD operations through the tRPC layer.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { getTestUser } from "../../../../utils/testUtils";
import { prisma } from "../../../db";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";

describe("Evaluators Endpoints", () => {
  const projectId = "test-project-id";
  let caller: ReturnType<typeof appRouter.createCaller>;

  beforeAll(async () => {
    // Clean up any existing test evaluators before running tests
    // This ensures we always start with a clean state
    await prisma.evaluator.deleteMany({
      where: { projectId },
    });

    const user = await getTestUser();
    const ctx = createInnerTRPCContext({
      session: {
        user: { id: user.id },
        expires: "1",
      },
    });
    caller = appRouter.createCaller(ctx);
  });

  describe("create", () => {
    it("creates a built-in evaluator with config", async () => {
      const result = await caller.evaluators.create({
        projectId,
        name: "Exact Match",
        type: "evaluator",
        config: {
          evaluatorType: "langevals/exact_match",
          settings: { caseSensitive: false },
        },
      });

      expect(result.id).toMatch(/^evaluator_/);
      expect(result.name).toBe("Exact Match");
      expect(result.type).toBe("evaluator");
      expect(result.config).toEqual({
        evaluatorType: "langevals/exact_match",
        settings: { caseSensitive: false },
      });
      expect(result.projectId).toBe(projectId);
      expect(result.archivedAt).toBeNull();
    });

    it("creates an LLM Judge evaluator", async () => {
      const result = await caller.evaluators.create({
        projectId,
        name: "Answer Correctness",
        type: "evaluator",
        config: {
          evaluatorType: "langevals/llm_judge",
          settings: {
            model: "openai/gpt-4o",
            criteria: "Is the answer correct?",
          },
        },
      });

      expect(result.id).toMatch(/^evaluator_/);
      expect(result.name).toBe("Answer Correctness");
      expect(result.type).toBe("evaluator");
    });

    it("creates a workflow evaluator with workflowId", async () => {
      const result = await caller.evaluators.create({
        projectId,
        name: "Custom Scorer",
        type: "workflow",
        config: {},
        workflowId: "workflow_scorer_123",
      });

      expect(result.type).toBe("workflow");
      expect(result.workflowId).toBe("workflow_scorer_123");
    });
  });

  describe("getAll", () => {
    it("returns all non-archived evaluators for project", async () => {
      const result = await caller.evaluators.getAll({ projectId });

      // Should have at least the evaluators we created above
      expect(result.length).toBeGreaterThanOrEqual(3);
      expect(result.every((e) => e.projectId === projectId)).toBe(true);
      expect(result.every((e) => e.archivedAt === null)).toBe(true);
    });

    it("returns evaluators ordered by most recently updated", async () => {
      const result = await caller.evaluators.getAll({ projectId });

      // Verify descending order by updatedAt
      for (let i = 1; i < result.length; i++) {
        const current = new Date(result[i]!.updatedAt).getTime();
        const previous = new Date(result[i - 1]!.updatedAt).getTime();
        expect(current).toBeLessThanOrEqual(previous);
      }
    });
  });

  describe("getById", () => {
    it("returns evaluator by id", async () => {
      // First create an evaluator
      const created = await caller.evaluators.create({
        projectId,
        name: "Findable Evaluator",
        type: "evaluator",
        config: { evaluatorType: "test" },
      });

      const found = await caller.evaluators.getById({
        id: created.id,
        projectId,
      });

      expect(found?.id).toBe(created.id);
      expect(found?.name).toBe("Findable Evaluator");
    });

    it("returns null for non-existent evaluator", async () => {
      const found = await caller.evaluators.getById({
        id: "evaluator_nonexistent",
        projectId,
      });

      expect(found).toBeNull();
    });
  });

  describe("update", () => {
    it("updates evaluator name", async () => {
      const created = await caller.evaluators.create({
        projectId,
        name: "Original Evaluator Name",
        type: "evaluator",
        config: { evaluatorType: "test" },
      });

      const updated = await caller.evaluators.update({
        id: created.id,
        projectId,
        name: "Updated Evaluator Name",
      });

      expect(updated.id).toBe(created.id);
      expect(updated.name).toBe("Updated Evaluator Name");
    });

    it("updates evaluator config", async () => {
      const created = await caller.evaluators.create({
        projectId,
        name: "Config Test Evaluator",
        type: "evaluator",
        config: { evaluatorType: "test", threshold: 0.5 },
      });

      const updated = await caller.evaluators.update({
        id: created.id,
        projectId,
        config: { evaluatorType: "test", threshold: 0.8 },
      });

      expect(updated.config).toEqual({ evaluatorType: "test", threshold: 0.8 });
    });
  });

  describe("delete (soft delete)", () => {
    it("soft deletes an evaluator by setting archivedAt", async () => {
      const created = await caller.evaluators.create({
        projectId,
        name: "Evaluator To Be Deleted",
        type: "evaluator",
        config: {},
      });

      const deleted = await caller.evaluators.delete({
        id: created.id,
        projectId,
      });

      expect(deleted.archivedAt).not.toBeNull();
    });

    it("soft deleted evaluators are excluded from getAll", async () => {
      const created = await caller.evaluators.create({
        projectId,
        name: "Evaluator Will Be Hidden",
        type: "evaluator",
        config: {},
      });

      await caller.evaluators.delete({
        id: created.id,
        projectId,
      });

      const all = await caller.evaluators.getAll({ projectId });
      const found = all.find((e) => e.id === created.id);

      expect(found).toBeUndefined();
    });

    it("soft deleted evaluators are excluded from getById", async () => {
      const created = await caller.evaluators.create({
        projectId,
        name: "Evaluator Will Be Hidden From GetById",
        type: "evaluator",
        config: {},
      });

      await caller.evaluators.delete({
        id: created.id,
        projectId,
      });

      const found = await caller.evaluators.getById({
        id: created.id,
        projectId,
      });

      expect(found).toBeNull();
    });
  });
});

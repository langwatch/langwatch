/**
 * @vitest-environment node
 *
 * Integration tests for Evaluators tRPC endpoints.
 * Tests the actual CRUD operations through the tRPC layer.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getTestUser } from "../../../../utils/testUtils";
import { prisma } from "../../../db";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";

describe("Evaluators Endpoints", () => {
  const projectId = "test-project-id";
  let caller: ReturnType<typeof appRouter.createCaller>;

  beforeAll(async () => {
    const user = await getTestUser();
    const ctx = createInnerTRPCContext({
      session: {
        user: { id: user.id },
        expires: "1",
      },
    });
    caller = appRouter.createCaller(ctx);
  });

  afterAll(async () => {
    // Final cleanup
    await prisma.evaluator.deleteMany({
      where: { projectId },
    });
  });

  describe("create", () => {
    beforeEach(async () => {
      // Clean up before each test to stay under FREE tier limits (max 3 evaluators)
      await prisma.evaluator.deleteMany({ where: { projectId } });
    });

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

    it("auto-generates slug from evaluator name", async () => {
      const result = await caller.evaluators.create({
        projectId,
        name: "My Custom Evaluator",
        type: "evaluator",
        config: { evaluatorType: "test" },
      });

      // Slug should be in format: slugified-name-XXXXX
      expect(result.slug).toMatch(/^my-custom-evaluator-[a-zA-Z0-9_-]{5}$/);
    });

    it("generates unique slugs for evaluators with same name", async () => {
      const result1 = await caller.evaluators.create({
        projectId,
        name: "Duplicate Name Test",
        type: "evaluator",
        config: { evaluatorType: "test" },
      });

      const result2 = await caller.evaluators.create({
        projectId,
        name: "Duplicate Name Test",
        type: "evaluator",
        config: { evaluatorType: "test" },
      });

      // Both should have slugs but they should be different
      expect(result1.slug).toMatch(/^duplicate-name-test-[a-zA-Z0-9_-]{5}$/);
      expect(result2.slug).toMatch(/^duplicate-name-test-[a-zA-Z0-9_-]{5}$/);
      expect(result1.slug).not.toBe(result2.slug);
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

    it("prevents creating duplicate evaluators for the same workflow", async () => {
      const workflowId = "workflow_unique_test_456";

      // Create first evaluator for this workflow
      await caller.evaluators.create({
        projectId,
        name: "First Evaluator",
        type: "workflow",
        config: {},
        workflowId,
      });

      // Attempt to create second evaluator for same workflow should fail
      await expect(
        caller.evaluators.create({
          projectId,
          name: "Second Evaluator",
          type: "workflow",
          config: {},
          workflowId,
        }),
      ).rejects.toThrow(/already exists for this workflow/);
    });
  });

  describe("getAll", () => {
    beforeEach(async () => {
      // Clean up and create fresh evaluators for getAll tests
      await prisma.evaluator.deleteMany({ where: { projectId } });
      // Create 3 evaluators for testing (within FREE tier limit)
      await caller.evaluators.create({
        projectId,
        name: "Evaluator 1",
        type: "evaluator",
        config: { evaluatorType: "test1" },
      });
      await caller.evaluators.create({
        projectId,
        name: "Evaluator 2",
        type: "evaluator",
        config: { evaluatorType: "test2" },
      });
      await caller.evaluators.create({
        projectId,
        name: "Evaluator 3",
        type: "evaluator",
        config: { evaluatorType: "test3" },
      });
    });

    it("returns all non-archived evaluators for project", async () => {
      const result = await caller.evaluators.getAll({ projectId });

      expect(result.length).toBe(3);
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
    beforeEach(async () => {
      await prisma.evaluator.deleteMany({ where: { projectId } });
    });

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

  describe("getBySlug", () => {
    beforeEach(async () => {
      await prisma.evaluator.deleteMany({ where: { projectId } });
    });

    it("returns evaluator by slug", async () => {
      const created = await caller.evaluators.create({
        projectId,
        name: "Slug Lookup Test",
        type: "evaluator",
        config: { evaluatorType: "test" },
      });

      const found = await caller.evaluators.getBySlug({
        slug: created.slug!,
        projectId,
      });

      expect(found?.id).toBe(created.id);
      expect(found?.name).toBe("Slug Lookup Test");
      expect(found?.slug).toBe(created.slug);
    });

    it("returns null for non-existent slug", async () => {
      const found = await caller.evaluators.getBySlug({
        slug: "non-existent-slug-12345",
        projectId,
      });

      expect(found).toBeNull();
    });

    it("excludes archived evaluators from slug lookup", async () => {
      const created = await caller.evaluators.create({
        projectId,
        name: "Archived Slug Test",
        type: "evaluator",
        config: {},
      });

      // Archive the evaluator
      await caller.evaluators.delete({
        id: created.id,
        projectId,
      });

      // Should not find by slug anymore
      const found = await caller.evaluators.getBySlug({
        slug: created.slug!,
        projectId,
      });

      expect(found).toBeNull();
    });
  });

  describe("update", () => {
    beforeEach(async () => {
      await prisma.evaluator.deleteMany({ where: { projectId } });
    });

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
    beforeEach(async () => {
      await prisma.evaluator.deleteMany({ where: { projectId } });
    });

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

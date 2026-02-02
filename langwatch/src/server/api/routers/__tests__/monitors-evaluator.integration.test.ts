/**
 * @vitest-environment node
 *
 * Integration tests for Monitor-Evaluator integration.
 * Tests creating and updating monitors with evaluatorId references.
 *
 * Requires: PostgreSQL database (Prisma)
 */
import { EvaluationExecutionMode } from "@prisma/client";
import { beforeAll, describe, expect, it } from "vitest";
import { getTestUser } from "../../../../utils/testUtils";
import { prisma } from "../../../db";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";

// Skip when running with testcontainers only (no PostgreSQL)
// TEST_CLICKHOUSE_URL indicates testcontainers mode without full infrastructure
const isTestcontainersOnly = !!process.env.TEST_CLICKHOUSE_URL;

describe.skipIf(isTestcontainersOnly)("Monitor-Evaluator Integration", () => {
  const projectId = "test-project-id";
  let caller: ReturnType<typeof appRouter.createCaller>;
  let testEvaluatorId: string;

  beforeAll(async () => {
    // Clean up any existing test monitors before running tests
    await prisma.monitor.deleteMany({
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

    // Create a test evaluator to link monitors to
    const evaluator = await caller.evaluators.create({
      projectId,
      name: "Test Evaluator for Monitor",
      type: "evaluator",
      config: {
        evaluatorType: "langevals/exact_match",
        settings: { caseSensitive: false },
      },
    });
    testEvaluatorId = evaluator.id;
  });

  describe("create with evaluatorId", () => {
    it("creates a monitor linked to an evaluator", async () => {
      const result = await caller.monitors.create({
        projectId,
        name: "Monitor With Evaluator",
        checkType: "langevals/exact_match",
        preconditions: [],
        settings: { caseSensitive: false },
        sample: 1.0,
        executionMode: EvaluationExecutionMode.ON_MESSAGE,
        evaluatorId: testEvaluatorId,
      });

      expect(result.id).toMatch(/^monitor_/);
      expect(result.name).toBe("Monitor With Evaluator");
      expect(result.evaluatorId).toBe(testEvaluatorId);
    });

    it("creates a monitor without evaluatorId (legacy mode)", async () => {
      const result = await caller.monitors.create({
        projectId,
        name: "Legacy Monitor",
        checkType: "langevals/exact_match",
        preconditions: [],
        settings: { caseSensitive: true },
        sample: 0.5,
        executionMode: EvaluationExecutionMode.ON_MESSAGE,
      });

      expect(result.id).toMatch(/^monitor_/);
      expect(result.evaluatorId).toBeNull();
    });

    it("throws error when evaluatorId does not exist", async () => {
      await expect(
        caller.monitors.create({
          projectId,
          name: "Monitor With Invalid Evaluator",
          checkType: "langevals/exact_match",
          preconditions: [],
          settings: {},
          sample: 1.0,
          executionMode: EvaluationExecutionMode.ON_MESSAGE,
          evaluatorId: "evaluator_nonexistent",
        }),
      ).rejects.toThrow("Evaluator not found");
    });

    it("throws error when evaluatorId belongs to different project", async () => {
      const otherProjectId = "other-project-id";

      // Create an evaluator in a different project
      const otherProjectEvaluator = await prisma.evaluator.create({
        data: {
          id: `evaluator_other_${Date.now()}`,
          projectId: otherProjectId,
          name: "Other Project Evaluator",
          type: "evaluator",
          config: {},
        },
      });

      await expect(
        caller.monitors.create({
          projectId,
          name: "Monitor With Wrong Project Evaluator",
          checkType: "langevals/exact_match",
          preconditions: [],
          settings: {},
          sample: 1.0,
          executionMode: EvaluationExecutionMode.ON_MESSAGE,
          evaluatorId: otherProjectEvaluator.id,
        }),
      ).rejects.toThrow("Evaluator not found");

      // Clean up - include projectId for multi-tenancy protection
      await prisma.evaluator.delete({
        where: { id: otherProjectEvaluator.id, projectId: otherProjectId },
      });
    });
  });

  describe("update with evaluatorId", () => {
    it("links an existing monitor to an evaluator", async () => {
      // Create a monitor without evaluatorId
      const created = await caller.monitors.create({
        projectId,
        name: "Monitor To Be Linked",
        checkType: "langevals/exact_match",
        preconditions: [],
        settings: { caseSensitive: false },
        sample: 1.0,
        executionMode: EvaluationExecutionMode.ON_MESSAGE,
      });

      expect(created.evaluatorId).toBeNull();

      // Update to link to evaluator
      const updated = await caller.monitors.update({
        id: created.id,
        projectId,
        name: "Monitor To Be Linked",
        checkType: "langevals/exact_match",
        preconditions: [],
        settings: { caseSensitive: false },
        mappings: {},
        sample: 1.0,
        executionMode: EvaluationExecutionMode.ON_MESSAGE,
        evaluatorId: testEvaluatorId,
      });

      expect(updated.evaluatorId).toBe(testEvaluatorId);
    });

    it("unlinks a monitor from an evaluator by setting null", async () => {
      // Create a monitor with evaluatorId
      const created = await caller.monitors.create({
        projectId,
        name: "Monitor To Be Unlinked",
        checkType: "langevals/exact_match",
        preconditions: [],
        settings: { caseSensitive: false },
        sample: 1.0,
        executionMode: EvaluationExecutionMode.ON_MESSAGE,
        evaluatorId: testEvaluatorId,
      });

      expect(created.evaluatorId).toBe(testEvaluatorId);

      // Update to unlink
      const updated = await caller.monitors.update({
        id: created.id,
        projectId,
        name: "Monitor To Be Unlinked",
        checkType: "langevals/exact_match",
        preconditions: [],
        settings: { caseSensitive: false },
        mappings: {},
        sample: 1.0,
        executionMode: EvaluationExecutionMode.ON_MESSAGE,
        evaluatorId: null,
      });

      expect(updated.evaluatorId).toBeNull();
    });
  });

  describe("queries include evaluator", () => {
    it("getById includes evaluator relation", async () => {
      const created = await caller.monitors.create({
        projectId,
        name: "Monitor For GetById Test",
        checkType: "langevals/exact_match",
        preconditions: [],
        settings: { caseSensitive: false },
        sample: 1.0,
        executionMode: EvaluationExecutionMode.ON_MESSAGE,
        evaluatorId: testEvaluatorId,
      });

      const found = await caller.monitors.getById({
        id: created.id,
        projectId,
      });

      expect(found.evaluator).toBeDefined();
      expect(found.evaluator?.id).toBe(testEvaluatorId);
      expect(found.evaluator?.name).toBe("Test Evaluator for Monitor");
    });

    it("getAllForProject includes evaluator relation", async () => {
      const monitors = await caller.monitors.getAllForProject({ projectId });

      // Find a monitor that has an evaluator
      const monitorWithEvaluator = monitors.find((m) => m.evaluatorId !== null);
      expect(monitorWithEvaluator).toBeDefined();
      expect(monitorWithEvaluator?.evaluator).toBeDefined();
      expect(monitorWithEvaluator?.evaluator?.id).toBe(
        monitorWithEvaluator?.evaluatorId,
      );
    });
  });
});

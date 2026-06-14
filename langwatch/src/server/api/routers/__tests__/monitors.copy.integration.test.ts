/**
 * @vitest-environment node
 *
 * Integration tests for `monitors.copy` — replicating an online evaluator
 * (monitor) into another project, through the real tRPC + Prisma layer.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getTestUser } from "../../../../utils/testUtils";
import { prisma } from "../../../db";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";

// Mock license enforcement to avoid limits during tests
vi.mock("../../../license-enforcement", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../license-enforcement")>();
  return {
    ...actual,
    enforceLicenseLimit: vi.fn(),
  };
});

describe("monitors.copy", () => {
  const sourceProjectId = "test-project-id";
  const targetProjectId = "test-project-id-monitor-copy-target";
  let caller: ReturnType<typeof appRouter.createCaller>;

  beforeAll(async () => {
    const user = await getTestUser();
    const teamUser = await prisma.teamUser.findFirst({
      where: { userId: user.id },
      include: { team: true },
    });
    if (!teamUser) {
      throw new Error("Test user must have a team");
    }

    // Target project lives in the same team so the caller has
    // evaluations:manage in both source and target.
    const exists = await prisma.project.findUnique({
      where: { id: targetProjectId },
    });
    if (!exists) {
      await prisma.project.create({
        data: {
          id: targetProjectId,
          name: "Monitor Copy Target",
          slug: "test-project-monitor-copy-target",
          apiKey: "test-api-key-monitor-copy-target",
          teamId: teamUser.team.id,
          language: "en",
          framework: "test-framework",
        },
      });
    }

    await prisma.monitor.deleteMany({
      where: { projectId: { in: [sourceProjectId, targetProjectId] } },
    });
    // Delete copies (target) before originals (source): a copied evaluator
    // references its source through the EvaluatorCopies self-relation.
    await prisma.evaluator.deleteMany({ where: { projectId: targetProjectId } });
    await prisma.evaluator.deleteMany({ where: { projectId: sourceProjectId } });

    const ctx = createInnerTRPCContext({
      session: { user: { id: user.id }, expires: "1" },
    });
    caller = appRouter.createCaller(ctx);
  });

  afterAll(async () => {
    await prisma.monitor.deleteMany({
      where: { projectId: { in: [sourceProjectId, targetProjectId] } },
    });
    // Delete copies (target) before originals (source): a copied evaluator
    // references its source through the EvaluatorCopies self-relation.
    await prisma.evaluator.deleteMany({ where: { projectId: targetProjectId } });
    await prisma.evaluator.deleteMany({ where: { projectId: sourceProjectId } });
  });

  describe("given a monitor with inline settings and no linked evaluator", () => {
    it("recreates a disabled monitor in the target project with the same config", async () => {
      const source = await caller.monitors.create({
        projectId: sourceProjectId,
        name: "Inline Monitor",
        checkType: "custom/test",
        preconditions: [],
        settings: { foo: "bar" },
        sample: 0.5,
        executionMode: "ON_MESSAGE",
        level: "trace",
      });

      const replica = await caller.monitors.copy({
        monitorId: source.id,
        projectId: targetProjectId,
        sourceProjectId,
      });

      expect(replica.id).not.toBe(source.id);
      expect(replica.projectId).toBe(targetProjectId);
      expect(replica.name).toBe("Inline Monitor");
      expect(replica.checkType).toBe("custom/test");
      expect(replica.parameters).toEqual({ foo: "bar" });
      expect(replica.sample).toBe(0.5);
      expect(replica.executionMode).toBe("ON_MESSAGE");
      expect(replica.evaluatorId).toBeNull();
      // Replicas land disabled so they don't start evaluating on copy.
      expect(replica.enabled).toBe(false);

      // Source is untouched.
      const sourceAfter = await prisma.monitor.findFirst({
        where: { id: source.id, projectId: sourceProjectId },
      });
      expect(sourceAfter?.projectId).toBe(sourceProjectId);
      expect(sourceAfter?.enabled).toBe(true);
    });
  });

  describe("given a monitor linked to a reusable evaluator", () => {
    it("copies the evaluator into the target and links the replica to it", async () => {
      const evaluator = await caller.evaluators.create({
        projectId: sourceProjectId,
        name: "Source Evaluator For Monitor",
        type: "evaluator",
        config: { evaluatorType: "langevals/exact_match", settings: {} },
      });

      const source = await caller.monitors.create({
        projectId: sourceProjectId,
        name: "Evaluator-backed Monitor",
        checkType: "custom/test",
        preconditions: [],
        settings: {},
        sample: 1,
        executionMode: "ON_MESSAGE",
        evaluatorId: evaluator.id,
      });

      const replica = await caller.monitors.copy({
        monitorId: source.id,
        projectId: targetProjectId,
        sourceProjectId,
      });

      expect(replica.evaluatorId).toBeTruthy();
      expect(replica.evaluatorId).not.toBe(evaluator.id);

      // The linked evaluator was copied into the target project and points
      // back at the source evaluator.
      const copiedEvaluator = await prisma.evaluator.findFirst({
        where: { id: replica.evaluatorId!, projectId: targetProjectId },
      });
      expect(copiedEvaluator?.projectId).toBe(targetProjectId);
      expect(copiedEvaluator?.copiedFromEvaluatorId).toBe(evaluator.id);
    });
  });

  describe("given a name that already exists in the target project", () => {
    it("de-duplicates the replicated monitor name", async () => {
      const source = await caller.monitors.create({
        projectId: sourceProjectId,
        name: "Dup Monitor",
        checkType: "custom/test",
        preconditions: [],
        settings: {},
        sample: 1,
        executionMode: "ON_MESSAGE",
      });

      const first = await caller.monitors.copy({
        monitorId: source.id,
        projectId: targetProjectId,
        sourceProjectId,
      });
      const second = await caller.monitors.copy({
        monitorId: source.id,
        projectId: targetProjectId,
        sourceProjectId,
      });

      expect(first.name).toBe("Dup Monitor");
      expect(second.name).not.toBe("Dup Monitor");
      expect(second.name).toContain("Dup Monitor");
    });
  });
});

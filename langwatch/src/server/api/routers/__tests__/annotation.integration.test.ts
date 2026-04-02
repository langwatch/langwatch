/**
 * @vitest-environment node
 *
 * Integration tests for annotation CRUD via the tRPC router with a real database.
 * ES writes are globally disabled (esSync is always null), so these tests
 * verify that annotations are persisted in Postgres without any ES interaction.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getTestUser } from "../../../../utils/testUtils";
import { prisma } from "../../../db";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";

describe("Annotation CRUD (ES sync disabled)", () => {
  const projectId = "test-project-id";
  const traceId = "test-trace-annotation-integration";
  let caller: ReturnType<typeof appRouter.createCaller>;

  beforeAll(async () => {
    await prisma.annotation.deleteMany({ where: { projectId } });

    const user = await getTestUser();
    const ctx = createInnerTRPCContext({
      session: {
        user: { id: user.id },
        expires: "1",
      },
    });
    caller = appRouter.createCaller(ctx);
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await prisma.annotation.deleteMany({ where: { projectId } });
  });

  describe("when creating an annotation", () => {
    it("persists the annotation in Postgres", async () => {
      const result = await caller.annotation.create({
        projectId,
        traceId,
        comment: "happy path",
        isThumbsUp: true,
        scoreOptions: {},
      });

      expect(result.id).toBeDefined();
      expect(result.comment).toBe("happy path");

      const persisted = await prisma.annotation.findFirst({
        where: { id: result.id, projectId },
      });
      expect(persisted).not.toBeNull();
      expect(persisted!.traceId).toBe(traceId);
    });
  });

  describe("when updating an annotation", () => {
    it("updates the annotation via the service layer", async () => {
      const created = await caller.annotation.create({
        projectId,
        traceId,
        comment: "original",
        isThumbsUp: false,
        scoreOptions: {},
      });

      const updated = await caller.annotation.updateByTraceId({
        id: created.id,
        projectId,
        traceId,
        comment: "updated",
        isThumbsUp: true,
        scoreOptions: {},
      });

      expect(updated.id).toBe(created.id);
      expect(updated.comment).toBe("updated");
      expect(updated.isThumbsUp).toBe(true);

      const persisted = await prisma.annotation.findFirst({
        where: { id: created.id, projectId },
      });
      expect(persisted!.comment).toBe("updated");
    });
  });

  describe("when deleting an annotation", () => {
    it("removes the annotation from Postgres", async () => {
      const created = await caller.annotation.create({
        projectId,
        traceId,
        comment: "to be deleted",
        scoreOptions: {},
      });

      const deleted = await caller.annotation.deleteById({
        annotationId: created.id,
        projectId,
      });

      expect(deleted.id).toBe(created.id);

      const persisted = await prisma.annotation.findFirst({
        where: { id: created.id, projectId },
      });
      expect(persisted).toBeNull();
    });
  });
});

/**
 * @vitest-environment node
 *
 * Integration tests for annotation CRUD via the tRPC router with a real database.
 * Mocks only the ES layer (AnnotationEsSync + isElasticSearchWriteDisabled).
 * Covers the non-fatal ES sync behavior from PR #2520.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getTestUser } from "../../../../utils/testUtils";
import { prisma } from "../../../db";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";

const { mockSyncAfterCreate, mockSyncAfterDelete, mockIsEsWriteDisabled } =
  vi.hoisted(() => ({
    mockSyncAfterCreate: vi.fn().mockResolvedValue(undefined),
    mockSyncAfterDelete: vi.fn().mockResolvedValue(undefined),
    mockIsEsWriteDisabled: vi.fn().mockResolvedValue(false),
  }));

vi.mock("~/server/annotations/annotationEsSync", () => ({
  AnnotationEsSync: class MockAnnotationEsSync {
    syncAfterCreate = mockSyncAfterCreate;
    syncAfterDelete = mockSyncAfterDelete;
  },
}));

vi.mock("~/server/elasticsearch/isElasticSearchWriteDisabled", () => ({
  isElasticSearchWriteDisabled: mockIsEsWriteDisabled,
}));

describe("Annotation CRUD with non-fatal ES sync", () => {
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
    mockIsEsWriteDisabled.mockResolvedValue(false);
    mockSyncAfterCreate.mockResolvedValue(undefined);
    mockSyncAfterDelete.mockResolvedValue(undefined);
  });

  afterAll(async () => {
    await prisma.annotation.deleteMany({ where: { projectId } });
  });

  describe("when creating an annotation", () => {
    describe("when ES sync succeeds", () => {
      it("persists the annotation and calls ES sync", async () => {
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

        expect(mockSyncAfterCreate).toHaveBeenCalledWith(traceId, projectId);
      });
    });

    describe("when ES sync throws", () => {
      it("persists the annotation in Postgres", async () => {
        mockSyncAfterCreate.mockRejectedValue(new Error("ES unavailable"));

        const result = await caller.annotation.create({
          projectId,
          traceId,
          comment: "ES will fail",
          isThumbsUp: true,
          scoreOptions: {},
        });

        expect(result.id).toBeDefined();

        const persisted = await prisma.annotation.findFirst({
          where: { id: result.id, projectId },
        });
        expect(persisted).not.toBeNull();
        expect(persisted!.isThumbsUp).toBe(true);
      });
    });

    describe("when isElasticSearchWriteDisabled is true", () => {
      it("skips ES sync and persists the annotation", async () => {
        mockIsEsWriteDisabled.mockResolvedValue(true);

        const result = await caller.annotation.create({
          projectId,
          traceId,
          comment: "ES disabled",
          scoreOptions: {},
        });

        const persisted = await prisma.annotation.findFirst({
          where: { id: result.id, projectId },
        });
        expect(persisted).not.toBeNull();

        expect(mockSyncAfterCreate).not.toHaveBeenCalled();
      });
    });

    describe("when isElasticSearchWriteDisabled rejects", () => {
      it("still persists the annotation", async () => {
        mockIsEsWriteDisabled.mockRejectedValue(new Error("DB lookup failed"));

        const result = await caller.annotation.create({
          projectId,
          traceId,
          comment: "ES check failed",
          scoreOptions: {},
        });

        const persisted = await prisma.annotation.findFirst({
          where: { id: result.id, projectId },
        });
        expect(persisted).not.toBeNull();

        expect(mockSyncAfterCreate).not.toHaveBeenCalled();
      });
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
    describe("when ES sync succeeds", () => {
      it("removes the annotation and calls ES sync", async () => {
        const created = await caller.annotation.create({
          projectId,
          traceId,
          comment: "delete happy path",
          scoreOptions: {},
        });
        vi.clearAllMocks();

        const deleted = await caller.annotation.deleteById({
          annotationId: created.id,
          projectId,
        });

        expect(deleted.id).toBe(created.id);

        const persisted = await prisma.annotation.findFirst({
          where: { id: created.id, projectId },
        });
        expect(persisted).toBeNull();

        expect(mockSyncAfterDelete).toHaveBeenCalledWith(traceId, projectId);
      });
    });

    describe("when ES sync throws", () => {
      it("removes the annotation from Postgres", async () => {
        const created = await caller.annotation.create({
          projectId,
          traceId,
          comment: "to be deleted",
          scoreOptions: {},
        });

        mockSyncAfterDelete.mockRejectedValue(new Error("ES unavailable"));

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
});

/**
 * @vitest-environment node
 *
 * Integration tests for annotation create/delete non-fatal ES sync behavior.
 * Verifies that annotations persist in Postgres even when Elasticsearch sync fails.
 * Covers the fix from PR #2520.
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

describe("Annotation non-fatal ES sync", () => {
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
        expect(result.comment).toBe("ES will fail");

        const persisted = await prisma.annotation.findFirst({
          where: { id: result.id, projectId },
        });
        expect(persisted).not.toBeNull();
        expect(persisted!.traceId).toBe(traceId);
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

        expect(result.id).toBeDefined();

        const persisted = await prisma.annotation.findFirst({
          where: { id: result.id, projectId },
        });
        expect(persisted).not.toBeNull();
        expect(persisted!.comment).toBe("ES disabled");

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

        expect(result.id).toBeDefined();

        const persisted = await prisma.annotation.findFirst({
          where: { id: result.id, projectId },
        });
        expect(persisted).not.toBeNull();
        expect(persisted!.comment).toBe("ES check failed");

        expect(mockSyncAfterCreate).not.toHaveBeenCalled();
      });
    });
  });

  describe("when deleting an annotation", () => {
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

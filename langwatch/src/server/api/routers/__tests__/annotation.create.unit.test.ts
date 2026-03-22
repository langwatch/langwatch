import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockEsClient, mockIsElasticSearchWriteDisabled } = vi.hoisted(() => ({
  mockEsClient: vi.fn(),
  mockIsElasticSearchWriteDisabled: vi.fn(),
}));

vi.mock("~/server/elasticsearch", () => ({
  esClient: mockEsClient,
  TRACE_INDEX: { alias: "trace_index" },
  TRACE_COLD_INDEX: { alias: "trace_cold_index" },
  traceIndexId: ({
    traceId,
    projectId,
  }: {
    traceId: string;
    projectId: string;
  }) => `${projectId}/${traceId}`,
}));

vi.mock("~/server/elasticsearch/isElasticSearchWriteDisabled", () => ({
  isElasticSearchWriteDisabled: mockIsElasticSearchWriteDisabled,
}));

vi.mock("~/server/auditLog", () => ({
  auditLog: vi.fn().mockResolvedValue(undefined),
}));

import { annotationRouter } from "../annotation";

/**
 * Creates a mock Prisma client that satisfies both RBAC middleware
 * and annotation mutation needs.
 */
function createMockPrisma({
  createResult,
  deleteResult,
}: {
  createResult?: Record<string, unknown>;
  deleteResult?: Record<string, unknown>;
} = {}) {
  const defaultAnnotation = {
    id: "ann-1",
    projectId: "proj-1",
    traceId: "trace-1",
    comment: "test",
    isThumbsUp: true,
    userId: "user-1",
    scoreOptions: {},
    expectedOutput: null,
  };

  return {
    $transaction: vi.fn(),
    annotation: {
      create: vi.fn().mockResolvedValue(createResult ?? defaultAnnotation),
      delete: vi.fn().mockResolvedValue(deleteResult ?? defaultAnnotation),
    },
    project: {
      findUnique: vi.fn().mockResolvedValue({
        // RBAC needs team.members
        team: {
          id: "team-1",
          members: [
            {
              userId: "user-1",
              teamId: "team-1",
              role: "ADMIN",
              assignedRoleId: null,
            },
          ],
        },
        // isElasticSearchWriteDisabled needs these flags
        disableElasticSearchTraceWriting: false,
        featureClickHouseDataSourceTraces: false,
        featureEventSourcingTraceIngestion: false,
      }),
    },
  } as any;
}

function createCaller(prisma: any) {
  return annotationRouter.createCaller({
    prisma,
    session: {
      user: { id: "user-1", role: "ADMIN" },
      expires: "2099-01-01",
    },
    permissionChecked: false,
  } as any);
}

function mockEsClientFailing() {
  mockEsClient.mockResolvedValue({
    update: vi.fn().mockRejectedValue(new Error("ES unavailable")),
    indices: {
      getAlias: vi
        .fn()
        .mockRejectedValue(new Error("alias [trace_cold_index] missing")),
    },
  });
}

function mockEsClientSucceeding() {
  mockEsClient.mockResolvedValue({
    update: vi.fn().mockResolvedValue({}),
    indices: {
      getAlias: vi
        .fn()
        .mockRejectedValue(new Error("alias [trace_cold_index] missing")),
    },
  });
}

describe("annotationRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsElasticSearchWriteDisabled.mockResolvedValue(false);
    mockEsClientSucceeding();
  });

  describe("create()", () => {
    describe("when ES update fails", () => {
      it("still returns the created annotation", async () => {
        mockEsClientFailing();

        const prisma = createMockPrisma();
        const caller = createCaller(prisma);

        const result = await caller.create({
          projectId: "proj-1",
          traceId: "trace-1",
          comment: "test annotation",
          scoreOptions: {},
        });

        expect(result).toMatchObject({ id: "ann-1", projectId: "proj-1" });
        expect(prisma.annotation.create).toHaveBeenCalledOnce();
      });

      it("does not roll back the Prisma insert", async () => {
        mockEsClientFailing();

        const prisma = createMockPrisma();
        const caller = createCaller(prisma);

        await caller.create({
          projectId: "proj-1",
          traceId: "trace-1",
          comment: "test annotation",
          scoreOptions: {},
        });

        expect(prisma.annotation.create).toHaveBeenCalledOnce();
        expect(prisma.$transaction).not.toHaveBeenCalled();
      });
    });

    describe("when disableElasticSearchTraceWriting is enabled", () => {
      it("creates the annotation without calling ES", async () => {
        mockIsElasticSearchWriteDisabled.mockResolvedValue(true);

        const prisma = createMockPrisma();
        const caller = createCaller(prisma);

        const result = await caller.create({
          projectId: "proj-1",
          traceId: "trace-1",
          comment: "test annotation",
          scoreOptions: {},
        });

        expect(result).toMatchObject({ id: "ann-1" });
        expect(prisma.annotation.create).toHaveBeenCalledOnce();
        expect(mockEsClient).not.toHaveBeenCalled();
        expect(mockIsElasticSearchWriteDisabled).toHaveBeenCalledWith(
          prisma,
          "proj-1",
          "traces"
        );
      });
    });

    describe("when ES update succeeds", () => {
      it("creates the annotation and updates ES", async () => {
        const prisma = createMockPrisma();
        const caller = createCaller(prisma);

        const result = await caller.create({
          projectId: "proj-1",
          traceId: "trace-1",
          comment: "test annotation",
          scoreOptions: {},
        });

        expect(result).toMatchObject({ id: "ann-1" });
        expect(prisma.annotation.create).toHaveBeenCalledOnce();
        expect(mockEsClient).toHaveBeenCalled();
      });
    });
  });

  describe("deleteById()", () => {
    describe("when ES update fails", () => {
      it("still returns the deleted annotation", async () => {
        mockEsClientFailing();

        const prisma = createMockPrisma();
        const caller = createCaller(prisma);

        const result = await caller.deleteById({
          annotationId: "ann-1",
          projectId: "proj-1",
        });

        expect(result).toMatchObject({ id: "ann-1" });
        expect(prisma.annotation.delete).toHaveBeenCalledOnce();
      });
    });

    describe("when disableElasticSearchTraceWriting is enabled", () => {
      it("deletes the annotation without calling ES", async () => {
        mockIsElasticSearchWriteDisabled.mockResolvedValue(true);

        const prisma = createMockPrisma();
        const caller = createCaller(prisma);

        const result = await caller.deleteById({
          annotationId: "ann-1",
          projectId: "proj-1",
        });

        expect(result).toMatchObject({ id: "ann-1" });
        expect(prisma.annotation.delete).toHaveBeenCalledOnce();
        expect(mockEsClient).not.toHaveBeenCalled();
        expect(mockIsElasticSearchWriteDisabled).toHaveBeenCalledWith(
          prisma,
          "proj-1",
          "traces"
        );
      });
    });

    describe("when ES update succeeds", () => {
      it("deletes the annotation and updates ES", async () => {
        const prisma = createMockPrisma();
        const caller = createCaller(prisma);

        const result = await caller.deleteById({
          annotationId: "ann-1",
          projectId: "proj-1",
        });

        expect(result).toMatchObject({ id: "ann-1" });
        expect(prisma.annotation.delete).toHaveBeenCalledOnce();
        expect(mockEsClient).toHaveBeenCalled();
      });
    });
  });
});

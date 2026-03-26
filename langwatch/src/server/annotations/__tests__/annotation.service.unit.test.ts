import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnnotationRepository } from "../annotation.repository";
import type { AnnotationEsSync } from "../annotationEsSync";
import { AnnotationService } from "../annotation.service";

vi.mock("~/server/elasticsearch/isElasticSearchWriteDisabled");
vi.mock("~/utils/logger/server", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));
vi.mock("../annotation.repository");
vi.mock("../annotationEsSync");

function createMockRepository(overrides?: {
  createResult?: Record<string, unknown>;
  updateResult?: Record<string, unknown>;
  deleteResult?: Record<string, unknown>;
}): AnnotationRepository {
  const defaultAnnotation = {
    id: "ann-1",
    projectId: "proj-1",
    traceId: "trace-1",
    comment: "test",
    isThumbsUp: true,
    userId: "user-1",
    scoreOptions: {},
    expectedOutput: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  return {
    create: vi.fn().mockResolvedValue(overrides?.createResult ?? defaultAnnotation),
    update: vi.fn().mockResolvedValue(overrides?.updateResult ?? defaultAnnotation),
    delete: vi.fn().mockResolvedValue(overrides?.deleteResult ?? defaultAnnotation),
  } as unknown as AnnotationRepository;
}

function createMockEsSync(): AnnotationEsSync {
  return {
    syncAfterCreate: vi.fn().mockResolvedValue(undefined),
    syncAfterDelete: vi.fn().mockResolvedValue(undefined),
  } as unknown as AnnotationEsSync;
}

function createMockLogger() {
  return {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  } as any;
}

const defaultCreateInput = {
  id: "ann-1",
  projectId: "proj-1",
  traceId: "trace-1",
  userId: "user-1",
  comment: "test annotation",
  isThumbsUp: null,
  scoreOptions: {},
  expectedOutput: null,
};

const defaultUpdateInput = {
  id: "ann-1",
  projectId: "proj-1",
  traceId: "trace-1",
  comment: "updated comment",
  isThumbsUp: false as boolean | null,
  scoreOptions: {},
  expectedOutput: null,
};

const defaultDeleteInput = {
  id: "ann-1",
  projectId: "proj-1",
};

describe("AnnotationService", () => {
  let logger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = createMockLogger();
  });

  describe("create()", () => {
    describe("when ES sync is enabled", () => {
      it("creates annotation and syncs to ES", async () => {
        const repository = createMockRepository();
        const esSync = createMockEsSync();
        const service = new AnnotationService(repository, esSync, logger);

        const result = await service.create(defaultCreateInput);

        expect(result).toMatchObject({ id: "ann-1", projectId: "proj-1" });
        expect(repository.create).toHaveBeenCalledWith(defaultCreateInput);
        expect(esSync.syncAfterCreate).toHaveBeenCalledWith("trace-1", "proj-1");
      });
    });

    describe("when ES sync is null (ES disabled)", () => {
      it("creates annotation without calling ES", async () => {
        const repository = createMockRepository();
        const service = new AnnotationService(repository, null, logger);

        const result = await service.create(defaultCreateInput);

        expect(result).toMatchObject({ id: "ann-1" });
        expect(repository.create).toHaveBeenCalledOnce();
      });
    });

    describe("when ES sync throws", () => {
      it("still returns the created annotation", async () => {
        const repository = createMockRepository();
        const esSync = createMockEsSync();
        vi.mocked(esSync.syncAfterCreate).mockRejectedValue(
          new Error("ES unavailable"),
        );
        const service = new AnnotationService(repository, esSync, logger);

        const result = await service.create(defaultCreateInput);

        expect(result).toMatchObject({ id: "ann-1", projectId: "proj-1" });
        expect(repository.create).toHaveBeenCalledOnce();
        expect(logger.error).toHaveBeenCalledWith(
          expect.objectContaining({
            traceId: "trace-1",
            projectId: "proj-1",
          }),
          "Failed to update Elasticsearch after annotation creation",
        );
      });
    });
  });

  describe("update()", () => {
    it("delegates to repository without ES sync", async () => {
      const repository = createMockRepository();
      const esSync = createMockEsSync();
      const service = new AnnotationService(repository, esSync, logger);

      const result = await service.update(defaultUpdateInput);

      expect(result).toMatchObject({ id: "ann-1" });
      expect(repository.update).toHaveBeenCalledWith(defaultUpdateInput);
      expect(esSync.syncAfterCreate).not.toHaveBeenCalled();
      expect(esSync.syncAfterDelete).not.toHaveBeenCalled();
    });
  });

  describe("delete()", () => {
    describe("when ES sync is enabled", () => {
      it("deletes annotation and syncs to ES", async () => {
        const repository = createMockRepository();
        const esSync = createMockEsSync();
        const service = new AnnotationService(repository, esSync, logger);

        const result = await service.delete(defaultDeleteInput);

        expect(result).toMatchObject({ id: "ann-1" });
        expect(repository.delete).toHaveBeenCalledWith(defaultDeleteInput);
        expect(esSync.syncAfterDelete).toHaveBeenCalledWith("trace-1", "proj-1");
      });
    });

    describe("when ES sync is null (ES disabled)", () => {
      it("deletes annotation without calling ES", async () => {
        const repository = createMockRepository();
        const service = new AnnotationService(repository, null, logger);

        const result = await service.delete(defaultDeleteInput);

        expect(result).toMatchObject({ id: "ann-1" });
        expect(repository.delete).toHaveBeenCalledOnce();
      });
    });

    describe("when ES sync throws", () => {
      it("still returns the deleted annotation", async () => {
        const repository = createMockRepository();
        const esSync = createMockEsSync();
        vi.mocked(esSync.syncAfterDelete).mockRejectedValue(
          new Error("ES unavailable"),
        );
        const service = new AnnotationService(repository, esSync, logger);

        const result = await service.delete(defaultDeleteInput);

        expect(result).toMatchObject({ id: "ann-1" });
        expect(repository.delete).toHaveBeenCalledOnce();
        expect(logger.error).toHaveBeenCalledWith(
          expect.objectContaining({
            traceId: "trace-1",
            projectId: "proj-1",
          }),
          "Failed to update Elasticsearch after annotation deletion",
        );
      });
    });
  });

  describe("static create() factory", () => {
    describe("when isElasticSearchWriteDisabled rejects", () => {
      it("returns a working service instead of propagating the error", async () => {
        const { isElasticSearchWriteDisabled } = await import(
          "~/server/elasticsearch/isElasticSearchWriteDisabled"
        );
        vi.mocked(isElasticSearchWriteDisabled).mockRejectedValue(
          new Error("DB connection failed"),
        );

        const mockPrisma = {} as any;
        const service = await AnnotationService.create({
          prisma: mockPrisma,
          projectId: "proj-1",
        });

        expect(service).toBeInstanceOf(AnnotationService);
      });
    });
  });
});

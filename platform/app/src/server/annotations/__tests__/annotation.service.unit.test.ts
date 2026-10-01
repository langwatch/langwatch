import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnnotationRepository } from "../annotation.repository";
import { AnnotationService } from "../annotation.service";

const { mockSyncAnnotationToTrace } = vi.hoisted(() => ({
  mockSyncAnnotationToTrace: vi.fn(),
}));

vi.mock("../annotation.repository");
vi.mock("../syncAnnotationToTrace", () => ({
  syncAnnotationToTrace: mockSyncAnnotationToTrace,
}));

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
    create: vi
      .fn()
      .mockResolvedValue(overrides?.createResult ?? defaultAnnotation),
    update: vi
      .fn()
      .mockResolvedValue(overrides?.updateResult ?? defaultAnnotation),
    delete: vi
      .fn()
      .mockResolvedValue(overrides?.deleteResult ?? defaultAnnotation),
  } as unknown as AnnotationRepository;
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
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("create()", () => {
    it("delegates to the repository", async () => {
      const repository = createMockRepository();
      const service = new AnnotationService(repository);

      const result = await service.create(defaultCreateInput);

      expect(result).toMatchObject({ id: "ann-1", projectId: "proj-1" });
      expect(repository.create).toHaveBeenCalledWith(defaultCreateInput);
    });

    it("records the annotation on its trace, so has:annotation finds it", async () => {
      const service = new AnnotationService(createMockRepository());

      await service.create(defaultCreateInput);

      expect(mockSyncAnnotationToTrace).toHaveBeenCalledWith({
        action: "add",
        projectId: "proj-1",
        traceId: "trace-1",
        annotationId: "ann-1",
      });
    });
  });

  describe("update()", () => {
    it("delegates to the repository", async () => {
      const repository = createMockRepository();
      const service = new AnnotationService(repository);

      const result = await service.update(defaultUpdateInput);

      expect(result).toMatchObject({ id: "ann-1" });
      expect(repository.update).toHaveBeenCalledWith(defaultUpdateInput);
    });

    it("leaves the trace alone, since the annotation id does not change", async () => {
      const service = new AnnotationService(createMockRepository());

      await service.update(defaultUpdateInput);

      expect(mockSyncAnnotationToTrace).not.toHaveBeenCalled();
    });
  });

  describe("delete()", () => {
    it("delegates to the repository", async () => {
      const repository = createMockRepository();
      const service = new AnnotationService(repository);

      const result = await service.delete(defaultDeleteInput);

      expect(result).toMatchObject({ id: "ann-1" });
      expect(repository.delete).toHaveBeenCalledWith(defaultDeleteInput);
    });

    it("removes the annotation from its trace, so has:annotation stops finding it", async () => {
      const service = new AnnotationService(createMockRepository());

      await service.delete(defaultDeleteInput);

      expect(mockSyncAnnotationToTrace).toHaveBeenCalledWith({
        action: "remove",
        projectId: "proj-1",
        traceId: "trace-1",
        annotationId: "ann-1",
      });
    });

    describe("when no annotation has that id in the project", () => {
      function serviceWithNothingToDelete() {
        const repository = createMockRepository();
        vi.mocked(repository.delete).mockResolvedValue(null);
        return new AnnotationService(repository);
      }

      it("refuses with annotation_not_found as a 404", async () => {
        await expect(
          serviceWithNothingToDelete().delete(defaultDeleteInput),
        ).rejects.toMatchObject({
          code: "annotation_not_found",
          httpStatus: 404,
        });
      });

      it("leaves the trace alone", async () => {
        await serviceWithNothingToDelete()
          .delete(defaultDeleteInput)
          .catch(() => undefined);

        expect(mockSyncAnnotationToTrace).not.toHaveBeenCalled();
      });
    });
  });

  describe("static create() factory", () => {
    it("returns a working service", () => {
      const mockPrisma = {} as any;
      const service = AnnotationService.create({ prisma: mockPrisma });

      expect(service).toBeInstanceOf(AnnotationService);
    });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnnotationRepository } from "../annotation.repository";
import { AnnotationService } from "../annotation.service";

vi.mock("../annotation.repository");

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
  });

  describe("update()", () => {
    it("delegates to the repository", async () => {
      const repository = createMockRepository();
      const service = new AnnotationService(repository);

      const result = await service.update(defaultUpdateInput);

      expect(result).toMatchObject({ id: "ann-1" });
      expect(repository.update).toHaveBeenCalledWith(defaultUpdateInput);
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
  });

  describe("static create() factory", () => {
    it("returns a working service", async () => {
      const mockPrisma = {} as any;
      const service = await AnnotationService.create({
        prisma: mockPrisma,
        projectId: "proj-1",
      });

      expect(service).toBeInstanceOf(AnnotationService);
    });
  });
});

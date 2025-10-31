import { describe, it, expect, beforeEach, vi } from "vitest";
import { type PrismaClient } from "@prisma/client";
import { DatasetRepository } from "../dataset.repository";

describe("DatasetRepository", () => {
  let prisma: PrismaClient;
  let repository: DatasetRepository;

  beforeEach(() => {
    prisma = {
      dataset: {
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        findFirstOrThrow: vi.fn(),
        findMany: vi.fn(),
      },
      project: {
        findUnique: vi.fn(),
      },
    } as unknown as PrismaClient;
    repository = new DatasetRepository(prisma);
  });

  describe("findOne", () => {
    describe("when dataset exists", () => {
      it("returns matching dataset by id and projectId", async () => {
        const mockDataset = { id: "ds-1", projectId: "proj-1", name: "Test" };
        vi.mocked(prisma.dataset.findFirst).mockResolvedValue(mockDataset as any);

        const result = await repository.findOne({ id: "ds-1", projectId: "proj-1" });

        expect(result).toEqual(mockDataset);
        expect(prisma.dataset.findFirst).toHaveBeenCalledWith({
          where: { id: "ds-1", projectId: "proj-1" },
        });
      });
    });

    describe("when dataset not found", () => {
      it("returns null", async () => {
        vi.mocked(prisma.dataset.findFirst).mockResolvedValue(null);

        const result = await repository.findOne({ id: "missing", projectId: "proj-1" });

        expect(result).toBeNull();
      });
    });
  });

  describe("findBySlug", () => {
    describe("when slug exists in project", () => {
      it("returns matching dataset", async () => {
        const mockDataset = { id: "ds-1", slug: "test-slug", projectId: "proj-1" };
        vi.mocked(prisma.dataset.findFirst).mockResolvedValue(mockDataset as any);

        const result = await repository.findBySlug({
          slug: "test-slug",
          projectId: "proj-1",
        });

        expect(result).toEqual(mockDataset);
      });
    });

    describe("when using excludeId", () => {
      it("excludes dataset with matching id", async () => {
        vi.mocked(prisma.dataset.findFirst).mockResolvedValue(null);

        await repository.findBySlug({
          slug: "test-slug",
          projectId: "proj-1",
          excludeId: "ds-1",
        });

        expect(prisma.dataset.findFirst).toHaveBeenCalledWith({
          where: {
            slug: "test-slug",
            projectId: "proj-1",
            id: { not: "ds-1" },
          },
        });
      });
    });

    describe("when slug not in project", () => {
      it("returns null", async () => {
        vi.mocked(prisma.dataset.findFirst).mockResolvedValue(null);

        const result = await repository.findBySlug({
          slug: "missing",
          projectId: "proj-1",
        });

        expect(result).toBeNull();
      });
    });
  });

  describe("create", () => {
    it("creates dataset with slug", async () => {
      const mockDataset = { id: "ds-1", slug: "test-slug", name: "Test" };
      vi.mocked(prisma.dataset.create).mockResolvedValue(mockDataset as any);

      const result = await repository.create({
        slug: "test-slug",
        name: "Test",
        projectId: "proj-1",
        columnTypes: [],
      });

      expect(result).toEqual(mockDataset);
    });
  });

  describe("update", () => {
    it("updates name and slug atomically", async () => {
      const mockDataset = { id: "ds-1", name: "Updated", slug: "updated-slug" };
      vi.mocked(prisma.dataset.update).mockResolvedValue(mockDataset as any);
      vi.mocked(prisma.dataset.findFirstOrThrow).mockResolvedValue(mockDataset as any);

      const result = await repository.update({
        id: "ds-1",
        projectId: "proj-1",
        data: { name: "Updated", slug: "updated-slug" },
      });

      expect(result).toEqual(mockDataset);
      expect(prisma.dataset.update).toHaveBeenCalledWith({
        where: { id: "ds-1", projectId: "proj-1" },
        data: { name: "Updated", slug: "updated-slug" },
      });
    });
  });

  describe("getProjectWithOrgS3Settings", () => {
    describe("when org has custom S3", () => {
      it("returns canUseS3 true", async () => {
        vi.mocked(prisma.project.findUnique).mockResolvedValue({
          id: "proj-1",
          team: { organization: { useCustomS3: true } },
        } as any);

        const result = await repository.getProjectWithOrgS3Settings({
          projectId: "proj-1",
        });

        expect(result.canUseS3).toBe(true);
      });
    });

    describe("when org has no custom S3", () => {
      it("returns canUseS3 false", async () => {
        vi.mocked(prisma.project.findUnique).mockResolvedValue({
          id: "proj-1",
          team: { organization: { useCustomS3: false } },
        } as any);

        const result = await repository.getProjectWithOrgS3Settings({
          projectId: "proj-1",
        });

        expect(result.canUseS3).toBe(false);
      });
    });
  });

  describe("findAllSlugs", () => {
    it("returns all slugs for project", async () => {
      const mockSlugs = [{ slug: "slug-1" }, { slug: "slug-2" }];
      vi.mocked(prisma.dataset.findMany).mockResolvedValue(mockSlugs as any);

      const result = await repository.findAllSlugs({ projectId: "proj-1" });

      expect(result).toEqual(mockSlugs);
      expect(prisma.dataset.findMany).toHaveBeenCalledWith({
        where: { projectId: "proj-1" },
        select: { slug: true },
      });
    });
  });
});


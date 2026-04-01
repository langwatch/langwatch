import { describe, it, expect, vi } from "vitest";
import {
  PromptTagConflictError,
  PromptTagProtectedError,
  PromptTagService,
  PromptTagValidationError,
  validateTagName,
} from "../prompt-tag.service";
import { PromptTagRepository } from "../repositories/prompt-tag.repository";
import type { PromptTag } from "@prisma/client";

function makeTag(overrides: Partial<PromptTag> = {}): PromptTag {
  return {
    id: "ptag_test",
    organizationId: "org_1",
    name: "canary",
    createdById: null,
    updatedById: null,
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
    ...overrides,
  };
}

function makeRepo(overrides: Partial<PromptTagRepository> = {}): PromptTagRepository {
  return {
    findAll: vi.fn().mockResolvedValue([]),
    findById: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue(makeTag()),
    delete: vi.fn().mockResolvedValue(undefined),
    seedForOrg: vi.fn().mockResolvedValue(undefined),
    isValidTagForOrg: vi.fn().mockResolvedValue(true),
    ...overrides,
  } as unknown as PromptTagRepository;
}

describe("validateTagName()", () => {
  describe("when name is valid", () => {
    it("does not throw for a lowercase slug", () => {
      expect(() => validateTagName("canary")).not.toThrow();
    });

    it("does not throw for names with hyphens and underscores", () => {
      expect(() => validateTagName("ab-test_v2")).not.toThrow();
    });
  });

  describe("when name is empty", () => {
    it("throws PromptTagValidationError", () => {
      expect(() => validateTagName("")).toThrow(PromptTagValidationError);
    });
  });

  describe("when name is purely numeric", () => {
    it("throws PromptTagValidationError mentioning numeric", () => {
      expect(() => validateTagName("42")).toThrow(
        expect.objectContaining({ name: "PromptTagValidationError", message: expect.stringMatching(/numeric/i) }),
      );
    });
  });

  describe("when name contains invalid characters", () => {
    it("throws for uppercase names", () => {
      expect(() => validateTagName("CANARY")).toThrow(PromptTagValidationError);
    });

    it("throws for names starting with a digit", () => {
      expect(() => validateTagName("1abc")).toThrow(PromptTagValidationError);
    });
  });

  describe("when name is a protected tag", () => {
    it("throws PromptTagValidationError mentioning protected for 'latest'", () => {
      expect(() => validateTagName("latest")).toThrow(
        expect.objectContaining({ name: "PromptTagValidationError", message: expect.stringMatching(/protected/i) }),
      );
    });
  });
});

describe("PromptTagService", () => {
  const organizationId = "org_1";

  describe("getAll()", () => {
    describe("when org has tags", () => {
      it("delegates to repo.findAll and returns tags", async () => {
        const tags = [makeTag({ name: "canary" }), makeTag({ name: "ab-test" })];
        const repo = makeRepo({ findAll: vi.fn().mockResolvedValue(tags) });
        const service = new PromptTagService(repo);

        const result = await service.getAll({ organizationId });

        expect(repo.findAll).toHaveBeenCalledWith({ organizationId });
        expect(result).toEqual(tags);
      });
    });

    describe("when org has no tags", () => {
      it("returns an empty array", async () => {
        const repo = makeRepo({ findAll: vi.fn().mockResolvedValue([]) });
        const service = new PromptTagService(repo);

        const result = await service.getAll({ organizationId });

        expect(result).toEqual([]);
      });
    });
  });

  describe("create()", () => {
    describe("when input is valid", () => {
      it("delegates to repo.create with all parameters", async () => {
        const tag = makeTag({ name: "canary" });
        const repo = makeRepo({ create: vi.fn().mockResolvedValue(tag) });
        const service = new PromptTagService(repo);

        const result = await service.create({
          organizationId,
          name: "canary",
          createdById: "user_1",
        });

        expect(repo.create).toHaveBeenCalledWith({
          organizationId,
          name: "canary",
          createdById: "user_1",
        });
        expect(result).toEqual(tag);
      });

      it("delegates without createdById when omitted", async () => {
        const tag = makeTag();
        const repo = makeRepo({ create: vi.fn().mockResolvedValue(tag) });
        const service = new PromptTagService(repo);

        await service.create({ organizationId, name: "canary" });

        expect(repo.create).toHaveBeenCalledWith({
          organizationId,
          name: "canary",
          createdById: undefined,
        });
      });
    });

    describe("when name fails validation", () => {
      it("throws PromptTagValidationError without calling repo.create", async () => {
        const repo = makeRepo();
        const service = new PromptTagService(repo);

        await expect(service.create({ organizationId, name: "INVALID" })).rejects.toThrow(
          PromptTagValidationError,
        );
        expect(repo.create).not.toHaveBeenCalled();
      });
    });

    describe("when repo signals a unique constraint violation", () => {
      it("throws PromptTagConflictError", async () => {
        const prismaError = { code: "P2002" };
        const repo = makeRepo({ create: vi.fn().mockRejectedValue(prismaError) });
        const service = new PromptTagService(repo);

        await expect(service.create({ organizationId, name: "canary" })).rejects.toThrow(
          PromptTagConflictError,
        );
      });
    });
  });

  describe("delete()", () => {
    describe("when tag does not exist", () => {
      it("returns null without calling repo.delete", async () => {
        const repo = makeRepo({ findById: vi.fn().mockResolvedValue(null) });
        const service = new PromptTagService(repo);

        const result = await service.delete({ id: "ptag_unknown", organizationId });

        expect(result).toBeNull();
        expect(repo.delete).not.toHaveBeenCalled();
      });
    });

    describe("when tag is a protected system tag", () => {
      it("throws PromptTagProtectedError for 'latest'", async () => {
        const tag = makeTag({ name: "latest" });
        const repo = makeRepo({ findById: vi.fn().mockResolvedValue(tag) });
        const service = new PromptTagService(repo);

        await expect(
          service.delete({ id: tag.id, organizationId }),
        ).rejects.toThrow(PromptTagProtectedError);
      });

      it("does not call repo.delete when tag is protected", async () => {
        const tag = makeTag({ name: "latest" });
        const repo = makeRepo({ findById: vi.fn().mockResolvedValue(tag) });
        const service = new PromptTagService(repo);

        await expect(service.delete({ id: tag.id, organizationId })).rejects.toThrow();
        expect(repo.delete).not.toHaveBeenCalled();
      });

      it("includes the tag name in the error message", async () => {
        const tag = makeTag({ name: "latest" });
        const repo = makeRepo({ findById: vi.fn().mockResolvedValue(tag) });
        const service = new PromptTagService(repo);

        await expect(
          service.delete({ id: tag.id, organizationId }),
        ).rejects.toThrow(/latest/);
      });
    });

    describe("when tag is a non-protected custom tag", () => {
      it("deletes the tag and returns it", async () => {
        const tag = makeTag({ name: "canary" });
        const repo = makeRepo({
          findById: vi.fn().mockResolvedValue(tag),
          delete: vi.fn().mockResolvedValue(undefined),
        });
        const service = new PromptTagService(repo);

        const result = await service.delete({ id: tag.id, organizationId });

        expect(repo.delete).toHaveBeenCalledWith({ id: tag.id, organizationId });
        expect(result).toEqual(tag);
      });

      it("deletes seeded tags (production, staging) without error", async () => {
        for (const name of ["production", "staging"]) {
          const tag = makeTag({ name });
          const repo = makeRepo({ findById: vi.fn().mockResolvedValue(tag) });
          const service = new PromptTagService(repo);

          const result = await service.delete({ id: tag.id, organizationId });
          expect(result).toEqual(tag);
        }
      });
    });
  });
});

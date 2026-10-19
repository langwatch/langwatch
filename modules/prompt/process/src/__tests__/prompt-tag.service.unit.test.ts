import {
  PromptTagConflictError,
  PromptTagNotFoundError,
  PromptTagProtectedError,
  PromptTagValidationError,
} from "@langwatch/prompt-contract";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import { PROTECTED_TAGS, type PromptTagRepository } from "../repositories/prompt-tag.repository.ts";
import { PromptTagService } from "../services/prompt-tag.service.ts";

/**
 * A stored tag as the catalogue itself hands one back, read off the repository
 * rather than off the generated client — a test double is only honest while it
 * is shaped by the seam it stands in for.
 */
type StoredPromptTag = Awaited<ReturnType<PromptTagRepository["create"]>>;

function makeTag(overrides: Partial<StoredPromptTag> = {}): StoredPromptTag {
  return {
    id: "ptag_test",
    organizationId: "org_1",
    name: "canary",
    createdById: null,
    createdAt: new Date("2024-01-01"),
    ...overrides,
  };
}

/**
 * The individual mocks are returned alongside the typed `repo` so assertions
 * can hold a mock directly, rather than extracting the abstract class's
 * method as an unbound value through `repo.<method>`.
 */
function makeRepo(
  overrides: Partial<{ [K in keyof PromptTagRepository]: Mock<PromptTagRepository[K]> }> = {},
) {
  const mocks = {
    findAll: vi.fn<PromptTagRepository["findAll"]>().mockResolvedValue([]),
    findById: vi.fn<PromptTagRepository["findById"]>().mockResolvedValue(null),
    findByName: vi.fn<PromptTagRepository["findByName"]>().mockResolvedValue(null),
    create: vi.fn<PromptTagRepository["create"]>().mockResolvedValue(makeTag()),
    delete: vi.fn<PromptTagRepository["delete"]>().mockResolvedValue(undefined),
    deleteByName: vi.fn<PromptTagRepository["deleteByName"]>().mockResolvedValue(undefined),
    rename: vi.fn<PromptTagRepository["rename"]>().mockResolvedValue(makeTag()),
    seedForOrg: vi.fn<PromptTagRepository["seedForOrg"]>().mockResolvedValue(undefined),
    existsForOrg: vi.fn<PromptTagRepository["existsForOrg"]>().mockResolvedValue(true),
    findByOrgAndName: vi.fn<PromptTagRepository["findByOrgAndName"]>().mockResolvedValue(null),
    ...overrides,
  };
  const repo: PromptTagRepository = mocks;
  return { repo, ...mocks };
}

describe("PromptTagService.validateTagName()", () => {
  describe("when name is valid", () => {
    /** @scenario "Validation accepts well-formed custom tag names" */
    it("does not throw for a lowercase slug", () => {
      expect(() => PromptTagService.validateTagName("canary")).not.toThrow();
    });

    it("does not throw for names with hyphens and underscores", () => {
      expect(() => PromptTagService.validateTagName("ab-test_v2")).not.toThrow();
    });

    /** @scenario 'Validation accepts "production" as a tag name' */
    /** @scenario "Accepts valid non-numeric tag during creation" */
    it("does not throw for the seeded 'production' tag name", () => {
      expect(() => PromptTagService.validateTagName("production")).not.toThrow();
    });

    /** @scenario 'Validation accepts "staging" as a tag name' */
    it("does not throw for the seeded 'staging' tag name", () => {
      expect(() => PromptTagService.validateTagName("staging")).not.toThrow();
    });
  });

  describe("when name is empty", () => {
    /** @scenario "Validation rejects empty tag names" */
    it("throws PromptTagValidationError mentioning empty", () => {
      expect(() => PromptTagService.validateTagName("")).toThrow(
        expect.objectContaining({
          name: "PromptTagValidationError",
          message: expect.stringMatching(/empty/i),
        }),
      );
    });
  });

  describe("when name is purely numeric", () => {
    /** @scenario "Validation rejects purely numeric tag names" */
    it("throws PromptTagValidationError mentioning numeric", () => {
      expect(() => PromptTagService.validateTagName("42")).toThrow(
        expect.objectContaining({
          name: "PromptTagValidationError",
          message: expect.stringMatching(/numeric/i),
        }),
      );
    });

    /** @scenario "Rejects zero as a tag name during creation" */
    it("rejects '0' (single-digit numeric)", () => {
      expect(() => PromptTagService.validateTagName("0")).toThrow(PromptTagValidationError);
    });
  });

  describe("when name contains invalid characters", () => {
    /** @scenario "Validation rejects uppercase tag names" */
    it("throws for uppercase names mentioning lowercase", () => {
      expect(() => PromptTagService.validateTagName("CANARY")).toThrow(
        expect.objectContaining({
          name: "PromptTagValidationError",
          message: expect.stringMatching(/lowercase/i),
        }),
      );
    });

    it("throws for names starting with a digit", () => {
      expect(() => PromptTagService.validateTagName("1abc")).toThrow(PromptTagValidationError);
    });
  });

  describe("when name is a protected tag", () => {
    /** @scenario 'Validation rejects creating a tag named "latest"' */
    /** @scenario 'Cannot create a tag that shadows the protected "latest" tag' */
    it("throws PromptTagValidationError mentioning protected for 'latest'", () => {
      expect(() => PromptTagService.validateTagName("latest")).toThrow(
        expect.objectContaining({
          name: "PromptTagValidationError",
          message: expect.stringMatching(/protected/i),
        }),
      );
    });
  });

  describe("when inspecting PROTECTED_TAGS", () => {
    /** @scenario 'Only "latest" is a protected tag' */
    /** @scenario 'Only "latest" is a protected (built-in) tag' */
    it("contains only 'latest'", () => {
      expect([...PROTECTED_TAGS]).toEqual(["latest"]);
    });
  });
});

describe("PromptTagService", () => {
  const organizationId = "org_1";

  describe("getAll()", () => {
    describe("when org has tags", () => {
      it("delegates to repo.findAll and returns tags", async () => {
        const tags = [makeTag({ name: "canary" }), makeTag({ name: "ab-test" })];
        const { repo, findAll } = makeRepo({
          findAll: vi.fn<PromptTagRepository["findAll"]>().mockResolvedValue(tags),
        });
        const service = PromptTagService.create(repo);

        const result = await service.getAll({ organizationId });

        expect(findAll).toHaveBeenCalledWith({ organizationId });
        expect(result).toEqual(tags);
      });
    });

    describe("when org has no tags", () => {
      it("returns an empty array", async () => {
        const { repo } = makeRepo({
          findAll: vi.fn<PromptTagRepository["findAll"]>().mockResolvedValue([]),
        });
        const service = PromptTagService.create(repo);

        const result = await service.getAll({ organizationId });

        expect(result).toEqual([]);
      });
    });
  });

  describe("create()", () => {
    describe("when input is valid", () => {
      /** @scenario prompt tags remain subordinate behaviour */
      it("delegates to repo.create with all parameters", async () => {
        const tag = makeTag({ name: "canary" });
        const { repo, create } = makeRepo({
          create: vi.fn<PromptTagRepository["create"]>().mockResolvedValue(tag),
        });
        const service = PromptTagService.create(repo);

        const result = await service.create({
          organizationId,
          name: "canary",
          createdById: "user_1",
        });

        expect(create).toHaveBeenCalledWith({
          organizationId,
          name: "canary",
          createdById: "user_1",
        });
        expect(result).toEqual(tag);
      });

      it("delegates without createdById when omitted", async () => {
        const tag = makeTag();
        const { repo, create } = makeRepo({
          create: vi.fn<PromptTagRepository["create"]>().mockResolvedValue(tag),
        });
        const service = PromptTagService.create(repo);

        await service.create({ organizationId, name: "canary" });

        expect(create).toHaveBeenCalledWith({
          organizationId,
          name: "canary",
          createdById: undefined,
        });
      });
    });

    describe("when name fails validation", () => {
      it("throws PromptTagValidationError without calling repo.create", async () => {
        const { repo, create } = makeRepo();
        const service = PromptTagService.create(repo);

        await expect(service.create({ organizationId, name: "INVALID" })).rejects.toThrow(
          PromptTagValidationError,
        );
        expect(create).not.toHaveBeenCalled();
      });
    });

    describe("when repo signals a unique constraint violation", () => {
      it("throws PromptTagConflictError", async () => {
        const prismaError = { code: "P2002" };
        const { repo } = makeRepo({
          create: vi.fn<PromptTagRepository["create"]>().mockRejectedValue(prismaError),
        });
        const service = PromptTagService.create(repo);

        await expect(service.create({ organizationId, name: "canary" })).rejects.toThrow(
          PromptTagConflictError,
        );
      });
    });
  });

  describe("delete()", () => {
    describe("when tag does not exist", () => {
      it("refuses without calling repo.delete", async () => {
        const { repo, delete: del } = makeRepo({
          findById: vi.fn<PromptTagRepository["findById"]>().mockResolvedValue(null),
        });
        const service = PromptTagService.create(repo);

        await expect(
          service.delete({
            id: "ptag_unknown",
            organizationId,
          }),
        ).rejects.toThrow(PromptTagNotFoundError);

        expect(del).not.toHaveBeenCalled();
      });
    });

    describe("when tag is a protected system tag", () => {
      let tag: StoredPromptTag;
      let repo: PromptTagRepository;
      let del: ReturnType<typeof vi.fn>;
      let service: PromptTagService;

      beforeEach(() => {
        tag = makeTag({ name: "latest" });
        ({ repo, delete: del } = makeRepo({
          findById: vi.fn<PromptTagRepository["findById"]>().mockResolvedValue(tag),
        }));
        service = PromptTagService.create(repo);
      });

      it("throws PromptTagProtectedError for 'latest'", async () => {
        await expect(service.delete({ id: tag.id, organizationId })).rejects.toThrow(
          PromptTagProtectedError,
        );
      });

      it("does not call repo.delete when tag is protected", async () => {
        await expect(service.delete({ id: tag.id, organizationId })).rejects.toThrow(
          PromptTagProtectedError,
        );
        expect(del).not.toHaveBeenCalled();
      });

      it("includes the tag name in the error message", async () => {
        await expect(service.delete({ id: tag.id, organizationId })).rejects.toThrow(/latest/);
      });
    });

    describe("when tag is a non-protected custom tag", () => {
      it("deletes the tag and returns it", async () => {
        const tag = makeTag({ name: "canary" });
        const { repo, delete: del } = makeRepo({
          findById: vi.fn<PromptTagRepository["findById"]>().mockResolvedValue(tag),
          delete: vi.fn<PromptTagRepository["delete"]>().mockResolvedValue(undefined),
        });
        const service = PromptTagService.create(repo);

        const result = await service.delete({ id: tag.id, organizationId });

        expect(del).toHaveBeenCalledWith({
          id: tag.id,
          organizationId,
        });
        expect(result).toEqual(tag);
      });

      it("deletes seeded tags (production, staging) without error", async () => {
        for (const name of ["production", "staging"]) {
          const tag = makeTag({ name });
          const { repo } = makeRepo({
            findById: vi.fn<PromptTagRepository["findById"]>().mockResolvedValue(tag),
          });
          const service = PromptTagService.create(repo);

          const result = await service.delete({ id: tag.id, organizationId });
          expect(result).toEqual(tag);
        }
      });
    });
  });

  describe("deleteByName()", () => {
    describe("when tag does not exist", () => {
      it("refuses without calling repo.deleteByName", async () => {
        const { repo, deleteByName } = makeRepo({
          findByName: vi.fn<PromptTagRepository["findByName"]>().mockResolvedValue(null),
        });
        const service = PromptTagService.create(repo);

        await expect(
          service.deleteByName({
            organizationId,
            name: "nonexistent",
          }),
        ).rejects.toThrow(PromptTagNotFoundError);

        expect(deleteByName).not.toHaveBeenCalled();
      });
    });

    describe("when tag is a protected system tag", () => {
      let repo: PromptTagRepository;
      let deleteByName: ReturnType<typeof vi.fn>;
      let service: PromptTagService;

      beforeEach(() => {
        ({ repo, deleteByName } = makeRepo());
        service = PromptTagService.create(repo);
      });

      it("throws PromptTagProtectedError for 'latest'", async () => {
        await expect(service.deleteByName({ organizationId, name: "latest" })).rejects.toThrow(
          PromptTagProtectedError,
        );
      });

      it("does not call repo.deleteByName when tag is protected", async () => {
        await expect(service.deleteByName({ organizationId, name: "latest" })).rejects.toThrow(
          PromptTagProtectedError,
        );
        expect(deleteByName).not.toHaveBeenCalled();
      });
    });

    describe("when tag is a non-protected custom tag", () => {
      it("deletes the tag and returns it", async () => {
        const tag = makeTag({ name: "canary" });
        const { repo, deleteByName } = makeRepo({
          findByName: vi.fn<PromptTagRepository["findByName"]>().mockResolvedValue(tag),
          deleteByName: vi.fn<PromptTagRepository["deleteByName"]>().mockResolvedValue(undefined),
        });
        const service = PromptTagService.create(repo);

        const result = await service.deleteByName({
          organizationId,
          name: "canary",
        });

        expect(deleteByName).toHaveBeenCalledWith({
          organizationId,
          name: "canary",
        });
        expect(result).toEqual(tag);
      });
    });
  });

  describe("rename()", () => {
    describe("when renaming a valid tag", () => {
      it("delegates to repo.rename with correct parameters", async () => {
        const renamedTag = makeTag({ name: "beta" });
        const { repo, rename } = makeRepo({
          rename: vi.fn<PromptTagRepository["rename"]>().mockResolvedValue(renamedTag),
        });
        const service = PromptTagService.create(repo);

        const result = await service.rename({
          organizationId,
          oldName: "canary",
          newName: "beta",
        });

        expect(rename).toHaveBeenCalledWith({
          organizationId,
          oldName: "canary",
          newName: "beta",
        });
        expect(result).toEqual(renamedTag);
      });
    });

    describe("when old name is a protected tag", () => {
      it("throws PromptTagProtectedError for 'latest'", async () => {
        const { repo, rename } = makeRepo();
        const service = PromptTagService.create(repo);

        await expect(
          service.rename({
            organizationId,
            oldName: "latest",
            newName: "beta",
          }),
        ).rejects.toThrow(PromptTagProtectedError);
        expect(rename).not.toHaveBeenCalled();
      });
    });

    describe("when new name fails validation", () => {
      it("throws PromptTagValidationError without calling repo.rename", async () => {
        const { repo, rename } = makeRepo();
        const service = PromptTagService.create(repo);

        await expect(
          service.rename({
            organizationId,
            oldName: "canary",
            newName: "INVALID",
          }),
        ).rejects.toThrow(PromptTagValidationError);
        expect(rename).not.toHaveBeenCalled();
      });
    });

    describe("when repo signals a unique constraint violation", () => {
      it("throws PromptTagConflictError", async () => {
        const prismaError = { code: "P2002" };
        const { repo } = makeRepo({
          rename: vi.fn<PromptTagRepository["rename"]>().mockRejectedValue(prismaError),
        });
        const service = PromptTagService.create(repo);

        await expect(
          service.rename({
            organizationId,
            oldName: "canary",
            newName: "staging",
          }),
        ).rejects.toThrow(PromptTagConflictError);
      });
    });

    describe("when repo throws not-found error", () => {
      it("throws PromptTagNotFoundError", async () => {
        const { repo } = makeRepo({
          rename: vi
            .fn<PromptTagRepository["rename"]>()
            .mockRejectedValue(new Error('Tag "canary" not found')),
        });
        const service = PromptTagService.create(repo);

        await expect(
          service.rename({
            organizationId,
            oldName: "canary",
            newName: "beta",
          }),
        ).rejects.toThrow(PromptTagNotFoundError);
      });
    });
  });
});

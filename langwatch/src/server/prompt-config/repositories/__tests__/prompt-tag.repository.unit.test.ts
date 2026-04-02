import { describe, it, expect, vi } from "vitest";
import {
  validateTagName,
  PromptTagValidationError,
} from "../../prompt-tag.service";
import { PROTECTED_TAGS, PromptTagRepository } from "../prompt-tag.repository";
import type { PrismaClient } from "@prisma/client";

function makeTag(overrides: Record<string, unknown> = {}) {
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

describe("PromptTagRepository", () => {
  const organizationId = "org_1";

  describe("findByName()", () => {
    describe("when tag exists for the org", () => {
      it("returns the tag", async () => {
        const tag = makeTag({ name: "canary" });
        const mockPrisma = {
          promptTag: {
            findFirst: vi.fn().mockResolvedValue(tag),
          },
        } as unknown as PrismaClient;
        const repo = new PromptTagRepository(mockPrisma);

        const result = await repo.findByName({ organizationId, name: "canary" });

        expect(result).toEqual(tag);
        expect(mockPrisma.promptTag.findFirst).toHaveBeenCalledWith({
          where: { organizationId, name: "canary" },
        });
      });
    });

    describe("when tag does not exist", () => {
      it("returns null", async () => {
        const mockPrisma = {
          promptTag: {
            findFirst: vi.fn().mockResolvedValue(null),
          },
        } as unknown as PrismaClient;
        const repo = new PromptTagRepository(mockPrisma);

        const result = await repo.findByName({ organizationId, name: "nonexistent" });

        expect(result).toBeNull();
      });
    });
  });

  describe("deleteByName()", () => {
    describe("when tag exists with assignments", () => {
      it("deletes tag and cascades to assignments", async () => {
        const tag = makeTag({ id: "ptag_1", name: "canary" });
        const mockTx = {
          promptTag: {
            findFirst: vi.fn().mockResolvedValue(tag),
            delete: vi.fn().mockResolvedValue(tag),
          },
          project: {
            findMany: vi.fn().mockResolvedValue([{ id: "proj_1" }]),
          },
          promptTagAssignment: {
            deleteMany: vi.fn().mockResolvedValue({ count: 2 }),
          },
        };
        const mockPrisma = {
          $transaction: vi.fn((fn: (tx: typeof mockTx) => Promise<void>) => fn(mockTx)),
        } as unknown as PrismaClient;
        const repo = new PromptTagRepository(mockPrisma);

        await repo.deleteByName({ organizationId, name: "canary" });

        expect(mockTx.promptTag.findFirst).toHaveBeenCalledWith({
          where: { organizationId, name: "canary" },
        });
        expect(mockTx.promptTagAssignment.deleteMany).toHaveBeenCalledWith({
          where: { tagId: "canary", projectId: { in: ["proj_1"] } },
        });
        expect(mockTx.promptTag.delete).toHaveBeenCalledWith({
          where: { id: "ptag_1" },
        });
      });
    });

    describe("when tag does not exist", () => {
      it("does nothing", async () => {
        const mockTx = {
          promptTag: {
            findFirst: vi.fn().mockResolvedValue(null),
            delete: vi.fn(),
          },
          project: { findMany: vi.fn() },
          promptTagAssignment: { deleteMany: vi.fn() },
        };
        const mockPrisma = {
          $transaction: vi.fn((fn: (tx: typeof mockTx) => Promise<void>) => fn(mockTx)),
        } as unknown as PrismaClient;
        const repo = new PromptTagRepository(mockPrisma);

        await repo.deleteByName({ organizationId, name: "nonexistent" });

        expect(mockTx.promptTag.delete).not.toHaveBeenCalled();
      });
    });
  });

  describe("rename()", () => {
    describe("when tag exists", () => {
      it("renames tag and updates assignments", async () => {
        const tag = makeTag({ id: "ptag_1", name: "canary" });
        const updatedTag = { ...tag, name: "beta" };
        const mockTx = {
          promptTag: {
            findFirst: vi.fn().mockResolvedValue(tag),
            update: vi.fn().mockResolvedValue(updatedTag),
          },
          project: {
            findMany: vi.fn().mockResolvedValue([{ id: "proj_1" }, { id: "proj_2" }]),
          },
          promptTagAssignment: {
            updateMany: vi.fn().mockResolvedValue({ count: 3 }),
          },
        };
        const mockPrisma = {
          $transaction: vi.fn((fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx)),
        } as unknown as PrismaClient;
        const repo = new PromptTagRepository(mockPrisma);

        const result = await repo.rename({ organizationId, oldName: "canary", newName: "beta" });

        expect(result).toEqual(updatedTag);
        expect(mockTx.promptTagAssignment.updateMany).toHaveBeenCalledWith({
          where: { tagId: "canary", projectId: { in: ["proj_1", "proj_2"] } },
          data: { tagId: "beta" },
        });
        expect(mockTx.promptTag.update).toHaveBeenCalledWith({
          where: { id: "ptag_1" },
          data: { name: "beta" },
        });
      });
    });

    describe("when tag does not exist", () => {
      it("throws an error", async () => {
        const mockTx = {
          promptTag: {
            findFirst: vi.fn().mockResolvedValue(null),
            update: vi.fn(),
          },
          project: { findMany: vi.fn() },
          promptTagAssignment: { updateMany: vi.fn() },
        };
        const mockPrisma = {
          $transaction: vi.fn((fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx)),
        } as unknown as PrismaClient;
        const repo = new PromptTagRepository(mockPrisma);

        await expect(
          repo.rename({ organizationId, oldName: "nonexistent", newName: "beta" }),
        ).rejects.toThrow(/not found/i);
      });
    });
  });
});

describe("validateTagName()", () => {
  describe("when name is a valid custom tag", () => {
    it("does not throw for 'canary'", () => {
      expect(() => validateTagName("canary")).not.toThrow();
    });

    it("does not throw for 'ab-test'", () => {
      expect(() => validateTagName("ab-test")).not.toThrow();
    });

    it("does not throw for 'my_tag'", () => {
      expect(() => validateTagName("my_tag")).not.toThrow();
    });

    it("does not throw for 'v2'", () => {
      expect(() => validateTagName("v2")).not.toThrow();
    });

    it("does not throw for 'a1b2c3'", () => {
      expect(() => validateTagName("a1b2c3")).not.toThrow();
    });

    it("does not throw for 'production'", () => {
      expect(() => validateTagName("production")).not.toThrow();
    });

    it("does not throw for 'staging'", () => {
      expect(() => validateTagName("staging")).not.toThrow();
    });
  });

  describe("when name is empty", () => {
    it("throws PromptTagValidationError", () => {
      expect(() => validateTagName("")).toThrow(PromptTagValidationError);
    });
  });

  describe("when name is purely numeric", () => {
    it("throws with message mentioning numeric", () => {
      expect(() => validateTagName("42")).toThrow(
        expect.objectContaining({
          name: "PromptTagValidationError",
          message: expect.stringMatching(/numeric/i),
        }),
      );
    });

    it("throws for '0'", () => {
      expect(() => validateTagName("0")).toThrow(PromptTagValidationError);
    });
  });

  describe("when name contains invalid characters", () => {
    it("throws for names with spaces", () => {
      expect(() => validateTagName("my tag")).toThrow(
        PromptTagValidationError,
      );
    });

    it("throws for names with slashes", () => {
      expect(() => validateTagName("can/ary")).toThrow(
        PromptTagValidationError,
      );
    });

    it("throws for uppercase names", () => {
      expect(() => validateTagName("CANARY")).toThrow(
        PromptTagValidationError,
      );
    });

    it("throws for names starting with a digit", () => {
      expect(() => validateTagName("1abc")).toThrow(
        PromptTagValidationError,
      );
    });

    it("throws for names with special chars", () => {
      expect(() => validateTagName("foo@bar")).toThrow(
        PromptTagValidationError,
      );
    });
  });

  describe("when name is a protected tag", () => {
    for (const protected_ of PROTECTED_TAGS) {
      it(`throws for '${protected_}' with message mentioning protected`, () => {
        expect(() => validateTagName(protected_)).toThrow(
          expect.objectContaining({
            name: "PromptTagValidationError",
            message: expect.stringMatching(/protected/i),
          }),
        );
      });
    }

    it("does not throw for 'production' (seeded tag, not protected)", () => {
      expect(() => validateTagName("production")).not.toThrow();
    });

    it("does not throw for 'staging' (seeded tag, not protected)", () => {
      expect(() => validateTagName("staging")).not.toThrow();
    });
  });
});

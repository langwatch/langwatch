/**
 * @vitest-environment node
 *
 * Integration tests for Secrets tRPC endpoints.
 * Tests the actual CRUD operations through the tRPC layer with a real database.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { decrypt } from "../../../../utils/encryption";
import { getTestUser } from "../../../../utils/testUtils";
import { prisma } from "../../../db";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";

// Mock license enforcement to avoid limits during tests
vi.mock("../../../license-enforcement", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../license-enforcement")>();
  return {
    ...actual,
    enforceLicenseLimit: vi.fn(),
  };
});

describe("Secrets Endpoints", () => {
  const projectId = "test-project-id";
  let caller: ReturnType<typeof appRouter.createCaller>;

  beforeAll(async () => {
    await prisma.projectSecret.deleteMany({ where: { projectId } });

    const user = await getTestUser();
    const ctx = createInnerTRPCContext({
      session: {
        user: { id: user.id },
        expires: "1",
      },
    });
    caller = appRouter.createCaller(ctx);
  });

  beforeEach(async () => {
    await prisma.projectSecret.deleteMany({ where: { projectId } });
  });

  afterAll(async () => {
    await prisma.projectSecret.deleteMany({ where: { projectId } }).catch(() => {});
  });

  describe("create", () => {
    describe("when creating a secret with valid input", () => {
      it("creates the secret and returns metadata without the value", async () => {
        const result = await caller.secrets.create({
          projectId,
          name: "MY_API_KEY",
          value: "super-secret-value",
        });

        expect(result.name).toBe("MY_API_KEY");
        expect(result.projectId).toBe(projectId);
        expect(result).not.toHaveProperty("encryptedValue");
        expect(result.createdBy).toEqual({ name: "Test User" });
        expect(result.updatedBy).toEqual({ name: "Test User" });
        expect(result.createdAt).toBeInstanceOf(Date);
      });

      it("encrypts the value in the database", async () => {
        const result = await caller.secrets.create({
          projectId,
          name: "ENCRYPTED_CHECK",
          value: "plaintext-value",
        });

        const dbRecord = await prisma.projectSecret.findFirst({
          where: { id: result.id, projectId },
        });

        expect(dbRecord).not.toBeNull();
        expect(dbRecord!.encryptedValue).not.toBe("plaintext-value");
        expect(decrypt(dbRecord!.encryptedValue)).toBe("plaintext-value");
      });
    });

    describe("when name is an invalid identifier", () => {
      it("rejects names with special characters", async () => {
        await expect(
          caller.secrets.create({
            projectId,
            name: "invalid-name!",
            value: "value",
          }),
        ).rejects.toThrow();
      });

      it("rejects lowercase names", async () => {
        await expect(
          caller.secrets.create({
            projectId,
            name: "lowercase",
            value: "value",
          }),
        ).rejects.toThrow();
      });

      it("rejects names starting with a digit", async () => {
        await expect(
          caller.secrets.create({
            projectId,
            name: "1INVALID",
            value: "value",
          }),
        ).rejects.toThrow();
      });
    });

    describe("when a secret with the same name already exists", () => {
      it("returns a CONFLICT error", async () => {
        await caller.secrets.create({
          projectId,
          name: "DUPLICATE_KEY",
          value: "first-value",
        });

        await expect(
          caller.secrets.create({
            projectId,
            name: "DUPLICATE_KEY",
            value: "second-value",
          }),
        ).rejects.toMatchObject({
          code: "CONFLICT",
          message: expect.stringContaining("already exists"),
        });
      });
    });
  });

  describe("list", () => {
    describe("when listing secrets for a project", () => {
      it("returns secrets sorted by name without values", async () => {
        await caller.secrets.create({ projectId, name: "ZEBRA_KEY", value: "v1" });
        await caller.secrets.create({ projectId, name: "ALPHA_KEY", value: "v2" });

        const result = await caller.secrets.list({ projectId });

        expect(result).toHaveLength(2);
        expect(result[0]!.name).toBe("ALPHA_KEY");
        expect(result[1]!.name).toBe("ZEBRA_KEY");
        expect(result[0]).not.toHaveProperty("encryptedValue");
        expect(result[0]!.createdBy).toEqual({ name: "Test User" });
      });
    });

    describe("when the project has no secrets", () => {
      it("returns an empty array", async () => {
        const result = await caller.secrets.list({ projectId });
        expect(result).toEqual([]);
      });
    });
  });

  describe("update", () => {
    describe("when updating a secret value", () => {
      it("replaces the encrypted value in the database", async () => {
        const created = await caller.secrets.create({
          projectId,
          name: "UPDATE_ME",
          value: "original-value",
        });

        const result = await caller.secrets.update({
          projectId,
          secretId: created.id,
          value: "new-value",
        });

        expect(result).toEqual({ success: true });

        const dbRecord = await prisma.projectSecret.findFirst({
          where: { id: created.id, projectId },
        });
        expect(decrypt(dbRecord!.encryptedValue)).toBe("new-value");
      });
    });

    describe("when the secret does not exist", () => {
      it("throws a NOT_FOUND error", async () => {
        await expect(
          caller.secrets.update({
            projectId,
            secretId: "nonexistent-id",
            value: "new-value",
          }),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
      });
    });
  });

  describe("delete", () => {
    describe("when deleting a secret", () => {
      it("removes the secret from the project", async () => {
        const created = await caller.secrets.create({
          projectId,
          name: "DELETE_ME",
          value: "temp-value",
        });

        const result = await caller.secrets.delete({
          projectId,
          secretId: created.id,
        });

        expect(result).toEqual({ success: true });

        const dbRecord = await prisma.projectSecret.findFirst({
          where: { id: created.id, projectId },
        });
        expect(dbRecord).toBeNull();
      });
    });

    describe("when the secret does not exist", () => {
      it("throws a NOT_FOUND error", async () => {
        await expect(
          caller.secrets.delete({
            projectId,
            secretId: "nonexistent-id",
          }),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
      });
    });
  });
});

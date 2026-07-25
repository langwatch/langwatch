/**
 * The REST twin of the tRPC secrets reserved-name guard
 * (`secrets.reserved-names.unit.test.ts`): the public /api/secrets routes go
 * through SecretsService, and an API key with `secrets:manage` must not be
 * able to read, overwrite, or delete a product-owned row the tRPC surface
 * already refuses. Reserved rows read as not-found so a response never
 * confirms they exist.
 */
import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { LANGY_VK_SECRET_NAME } from "~/server/projects/reserved-secret-names";

vi.mock("~/utils/encryption", () => ({
  encrypt: (v: string) => `enc(${v})`,
  decrypt: (v: string) => v,
}));

import { SecretsService } from "../secrets.service";

const PROJECT_ID = "proj_1";
const NOW = new Date("2026-01-01T00:00:00Z");

function mockPrisma(overrides?: {
  findFirst?: ReturnType<typeof vi.fn>;
  findMany?: ReturnType<typeof vi.fn>;
}) {
  const fns = {
    findMany: overrides?.findMany ?? vi.fn().mockResolvedValue([]),
    findFirst: overrides?.findFirst ?? vi.fn().mockResolvedValue(null),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn().mockResolvedValue(0),
    create: vi.fn(),
  };
  return {
    prisma: { projectSecret: fns } as unknown as PrismaClient,
    fns,
  };
}

function reservedRow() {
  return {
    id: "sec_1",
    projectId: PROJECT_ID,
    name: LANGY_VK_SECRET_NAME,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

describe("SecretsService reserved-name guard", () => {
  describe("when listing a project's secrets", () => {
    it("excludes product-owned rows from the query", async () => {
      const { prisma, fns } = mockPrisma();
      await new SecretsService(prisma).getAll({ projectId: PROJECT_ID });

      expect(fns.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            projectId: PROJECT_ID,
            name: { notIn: expect.arrayContaining([LANGY_VK_SECRET_NAME]) },
          }),
        }),
      );
    });
  });

  describe("given the caller targets the Langy virtual-key secret by id", () => {
    it("reads it as not-found", async () => {
      const { prisma } = mockPrisma({
        findFirst: vi.fn().mockResolvedValue(reservedRow()),
      });

      await expect(
        new SecretsService(prisma).getById({
          id: "sec_1",
          projectId: PROJECT_ID,
        }),
      ).resolves.toBeNull();
    });

    it("refuses to overwrite its value, reporting not-found", async () => {
      const { prisma, fns } = mockPrisma({
        findFirst: vi.fn().mockResolvedValue(reservedRow()),
      });

      await expect(
        new SecretsService(prisma).update({
          id: "sec_1",
          projectId: PROJECT_ID,
          value: "hijacked",
        }),
      ).resolves.toBeNull();
      expect(fns.update).not.toHaveBeenCalled();
    });

    it("refuses to delete it, reporting not-found", async () => {
      const { prisma, fns } = mockPrisma({
        findFirst: vi.fn().mockResolvedValue(reservedRow()),
      });

      await expect(
        new SecretsService(prisma).delete({
          id: "sec_1",
          projectId: PROJECT_ID,
        }),
      ).resolves.toBe(false);
      expect(fns.delete).not.toHaveBeenCalled();
    });
  });

  describe("when creating a secret with a reserved name", () => {
    it("refuses it before touching the database", async () => {
      // The uppercase-only name schema already can't produce the lowercase
      // reserved name; this pins the boundary in the service instead of
      // trusting that disjointness to hold forever.
      const { prisma, fns } = mockPrisma();

      await expect(
        new SecretsService(prisma).create({
          projectId: PROJECT_ID,
          teamId: "team_1",
          name: LANGY_VK_SECRET_NAME,
          value: "squatted",
        }),
      ).resolves.toMatchObject({ status: 422 });
      expect(fns.create).not.toHaveBeenCalled();
    });
  });

  describe("given the caller targets one of their own secrets", () => {
    it("deletes it", async () => {
      // The discriminating positive case: the guard keys on the name, not on
      // refusing every row.
      const { prisma, fns } = mockPrisma({
        findFirst: vi
          .fn()
          .mockResolvedValue({ ...reservedRow(), id: "sec_2", name: "MY_API_KEY" }),
      });

      await expect(
        new SecretsService(prisma).delete({
          id: "sec_2",
          projectId: PROJECT_ID,
        }),
      ).resolves.toBe(true);
      expect(fns.delete).toHaveBeenCalled();
    });
  });
});

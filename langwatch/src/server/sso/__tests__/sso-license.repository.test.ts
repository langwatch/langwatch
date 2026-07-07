import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { SsoLicenseRepository } from "../sso-license.repository";

describe("SsoLicenseRepository", () => {
  describe("findOrganizationsWithLicense", () => {
    it("queries only organizations with a non-null license", async () => {
      const findMany = vi.fn().mockResolvedValue([
        { id: "org_1", license: "encoded-1" },
        { id: "org_2", license: "encoded-2" },
      ]);
      const prisma = { organization: { findMany } } as unknown as PrismaClient;
      const repository = new SsoLicenseRepository(prisma);

      const result = await repository.findOrganizationsWithLicense();

      expect(findMany).toHaveBeenCalledWith({
        where: { license: { not: null } },
        select: { id: true, license: true },
      });
      expect(result).toEqual([
        { id: "org_1", license: "encoded-1" },
        { id: "org_2", license: "encoded-2" },
      ]);
    });

    it("filters out any row whose license came back null despite the where clause", async () => {
      const findMany = vi.fn().mockResolvedValue([
        { id: "org_1", license: "encoded-1" },
        { id: "org_2", license: null },
      ]);
      const prisma = { organization: { findMany } } as unknown as PrismaClient;
      const repository = new SsoLicenseRepository(prisma);

      const result = await repository.findOrganizationsWithLicense();

      expect(result).toEqual([{ id: "org_1", license: "encoded-1" }]);
    });

    it("propagates a DB error instead of swallowing it (the gate decides not-to-memoize)", async () => {
      const findMany = vi
        .fn()
        .mockRejectedValue(new Error("connection refused"));
      const prisma = { organization: { findMany } } as unknown as PrismaClient;
      const repository = new SsoLicenseRepository(prisma);

      await expect(repository.findOrganizationsWithLicense()).rejects.toThrow(
        "connection refused",
      );
    });
  });
});

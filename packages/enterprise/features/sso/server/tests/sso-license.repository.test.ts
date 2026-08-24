// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { describe, expect, it, vi } from "vitest";
import { PrismaSsoLicenseRepository } from "../src/repositories/prisma/prisma.sso-license.repository";

describe("PrismaSsoLicenseRepository", () => {
  describe("when asked for the organizations holding a license", () => {
    it("queries only organizations with a non-null license", async () => {
      const findMany = vi.fn().mockResolvedValue([
        { id: "org_1", license: "encoded-1" },
        { id: "org_2", license: "encoded-2" },
      ]);
      const prisma = { organization: { findMany } };
      const repository = PrismaSsoLicenseRepository.create(prisma);

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
      const prisma = { organization: { findMany } };
      const repository = PrismaSsoLicenseRepository.create(prisma);

      const result = await repository.findOrganizationsWithLicense();

      expect(result).toEqual([{ id: "org_1", license: "encoded-1" }]);
    });

    it("propagates a DB error instead of swallowing it (the gate decides not-to-memoize)", async () => {
      const findMany = vi
        .fn()
        .mockRejectedValue(new Error("connection refused"));
      const prisma = { organization: { findMany } };
      const repository = PrismaSsoLicenseRepository.create(prisma);

      await expect(repository.findOrganizationsWithLicense()).rejects.toThrow(
        "connection refused",
      );
    });
  });
});

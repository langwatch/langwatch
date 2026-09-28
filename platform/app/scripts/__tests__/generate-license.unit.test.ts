/**
 * The mint script's two writes: the registry row and the license on the
 * organization.
 *
 * Spec: specs/self-hosting/connected-services/license-registry.feature
 */
import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import { applyLicenseToOrg } from "../generate-license";

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

/**
 * Enough of Prisma to run the script's writes, recording what each one did and
 * whether the transaction callback carried them both.
 */
function fakePrisma({
  organizationUpdateFails,
}: {
  organizationUpdateFails: boolean;
}) {
  const writes: string[] = [];
  const tx = {
    issuedLicense: {
      findUnique: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        writes.push("registry row");
        return {
          ...data,
          id: "il_1",
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      },
    },
    organization: {
      update: async () => {
        writes.push("organization license");
        if (organizationUpdateFails)
          throw new Error("the organization is gone");
        return {};
      },
    },
  };
  const prisma = {
    organization: {
      findUnique: async () => ({ id: "org_1", name: "ACME", slug: "acme" }),
    },
    $transaction: async (run: (client: typeof tx) => Promise<unknown>) => {
      try {
        return await run(tx);
      } catch (error) {
        writes.push("rolled back");
        throw error;
      }
    },
  };
  return { prisma: prisma as unknown as PrismaClient, writes };
}

describe("applyLicenseToOrg", () => {
  describe("given the license is minted for an organization", () => {
    it("writes the registry row and the organization's license in one transaction", async () => {
      const { prisma, writes } = fakePrisma({ organizationUpdateFails: false });

      await applyLicenseToOrg({
        prisma,
        organizationId: "org_1",
        planType: "ENTERPRISE",
        privateKey,
      });

      expect(writes).toEqual(["registry row", "organization license"]);
    });
  });

  describe("given writing the license onto the organization fails", () => {
    /** @scenario The minted license and its registry row are written together */
    it("rolls the registry row back with it", async () => {
      const { prisma, writes } = fakePrisma({ organizationUpdateFails: true });

      await expect(
        applyLicenseToOrg({
          prisma,
          organizationId: "org_1",
          planType: "ENTERPRISE",
          privateKey,
        }),
      ).rejects.toThrow("the organization is gone");

      expect(writes).toEqual([
        "registry row",
        "organization license",
        "rolled back",
      ]);
    });
  });
});

/**
 * The four sign-in security columns, as the live repository asks Postgres for them.
 * @see specs/identity/org-account-lockout.feature
 * @see specs/identity/org-session-lifetime.feature
 */
import { OrganizationNotFoundError } from "@langwatch/organization-contract";
import { aesEncryption } from "@langwatch/process-stores";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { describe, expect, it, vi } from "vitest";

import { PrismaOrganizationRepository } from "../prisma.organization.repository.ts";

const cipher = aesEncryption(new Uint8Array(32));
const COLUMNS = {
  lockoutAfterFailedAttempts: true,
  lockoutMinutes: true,
  sessionIdleTimeoutMinutes: true,
  sessionMaxLifetimeMinutes: true,
};
const STRICT = {
  lockoutAfterFailedAttempts: 5,
  lockoutMinutes: 15,
  sessionIdleTimeoutMinutes: 60,
  sessionMaxLifetimeMinutes: 480,
};

function repositoryOver(organization: Record<string, unknown>) {
  return PrismaOrganizationRepository.create({
    database: prismaDouble({ organization }),
    cipher,
  });
}

describe("PrismaOrganizationRepository sign-in security policy", () => {
  describe("when one organization's rule is read", () => {
    it("selects the four columns by id", async () => {
      const findUnique = vi.fn().mockResolvedValue(STRICT);

      await expect(
        repositoryOver({ findUnique }).getSignInSecurityPolicy({ organizationId: "acme" }),
      ).resolves.toEqual(STRICT);
      expect(findUnique).toHaveBeenCalledWith({ where: { id: "acme" }, select: COLUMNS });
    });

    it("throws the organization's not-found error for an unknown id", async () => {
      const findUnique = vi.fn().mockResolvedValue(null);

      await expect(
        repositoryOver({ findUnique }).getSignInSecurityPolicy({ organizationId: "nobody" }),
      ).rejects.toBeInstanceOf(OrganizationNotFoundError);
    });
  });

  describe("when a rule is updated", () => {
    it("writes the four columns on that organization", async () => {
      const update = vi.fn().mockResolvedValue(void 0);

      await repositoryOver({ update }).updateSignInSecurityPolicy({
        organizationId: "acme",
        policy: STRICT,
      });

      expect(update).toHaveBeenCalledWith({ where: { id: "acme" }, data: STRICT });
    });
  });

  describe("when a person's rules are read", () => {
    it("goes through Organization filtered by an enabled membership", async () => {
      const findMany = vi.fn().mockResolvedValue([STRICT]);

      await expect(
        repositoryOver({ findMany }).findSignInSecurityPoliciesForUser({ userId: "sam" }),
      ).resolves.toEqual([STRICT]);
      expect(findMany).toHaveBeenCalledWith({
        where: { members: { some: { userId: "sam", disabledAt: null } } },
        select: COLUMNS,
      });
    });
  });

  describe("when the installation is scanned for configured rules", () => {
    it("asks for organizations that set any rule", async () => {
      const findMany = vi.fn().mockResolvedValue([STRICT]);

      await expect(
        repositoryOver({ findMany }).findConfiguredSignInSecurityPolicies(),
      ).resolves.toEqual([STRICT]);
      expect(findMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { lockoutAfterFailedAttempts: { gt: 0 } },
            { sessionIdleTimeoutMinutes: { gt: 0 } },
            { sessionMaxLifetimeMinutes: { gt: 0 } },
          ],
        },
        select: COLUMNS,
      });
    });
  });
});

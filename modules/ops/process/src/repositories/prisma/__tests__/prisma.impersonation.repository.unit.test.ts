import { guardOrganizationId } from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { describe, expect, it, vi } from "vitest";

import { PrismaImpersonationRepository } from "../prisma.admin.repository.ts";

/**
 * A top-level `organizationUser.findMany` for "which of this person's
 * organizations require a second factor" carries no single-organization
 * predicate; the real guard below refuses it, so that failure lands here.
 */
function stubDatabase({ row, session }: { row: unknown; session?: unknown }) {
  const userFindUnique = vi.fn().mockResolvedValue(row);
  const sessionFindUnique = vi.fn().mockResolvedValue(session ?? null);
  const organizationUserFindMany = vi.fn(async (args: unknown) =>
    guardOrganizationId({ model: "OrganizationUser", action: "findMany", args }, async () => []),
  );
  return {
    userFindUnique,
    organizationUserFindMany,
    database: {
      user: { findUnique: userFindUnique },
      session: { findUnique: sessionFindUnique },
      organizationUser: { findMany: organizationUserFindMany },
    } as unknown as PrismaClient,
  };
}

describe("PrismaImpersonationRepository", () => {
  describe("when it reads the impersonation target", () => {
    /** @scenario "Looking up the requirement decides the request rather than failing it" */
    it("reads the requiring organizations nested off the target row", async () => {
      const { database, userFindUnique, organizationUserFindMany } = stubDatabase({
        row: {
          id: "user_target",
          name: "Target",
          email: "target@example.com",
          image: null,
          deactivatedAt: null,
          orgMemberships: [{ organization: { slug: "acme" } }],
        },
      });

      const target =
        await PrismaImpersonationRepository.create(database).tryFindTarget("user_target");

      expect(target?.mfaRequiredOrganizationSlugs).toEqual(["acme"]);
      expect(organizationUserFindMany).not.toHaveBeenCalled();
      const [read] = userFindUnique.mock.calls[0]!;
      expect(read.select).toHaveProperty("orgMemberships");
    });

    it("answers null for a target that does not exist", async () => {
      const { database } = stubDatabase({ row: null });

      await expect(
        PrismaImpersonationRepository.create(database).tryFindTarget("user_missing"),
      ).resolves.toBeNull();
    });
  });

  describe("when it reads the window a session already carries", () => {
    /** @scenario "An operator cannot hop from one impersonation straight into another" */
    it("reads the stored claims back as a window", async () => {
      const { database } = stubDatabase({
        row: null,
        session: {
          impersonating: {
            id: "user_subject",
            name: "Subject",
            email: "subject@example.com",
            image: null,
            expires: "2026-01-01T01:00:00.000Z",
          },
        },
      });

      const window = await PrismaImpersonationRepository.create(database).findWindow("session_1");

      expect(window?.id).toBe("user_subject");
      expect(window?.expires.toString({ fractionalSecondDigits: 3 })).toBe(
        "2026-01-01T01:00:00.000Z",
      );
    });

    it("answers null for a session carrying no claims at all", async () => {
      const { database } = stubDatabase({ row: null, session: { impersonating: null } });

      await expect(
        PrismaImpersonationRepository.create(database).findWindow("session_1"),
      ).resolves.toBeNull();
    });
  });

  describe("when it is asked whether the operator can prove a second factor", () => {
    /** @scenario "Impersonating into an organization that requires it takes the operator's own" */
    it("answers from the operator's own enrollment", async () => {
      const { database } = stubDatabase({ row: { twoFactorEnabled: true } });

      await expect(
        PrismaImpersonationRepository.create(database).hasSecondFactor("user_admin"),
      ).resolves.toBe(true);
    });
  });
});

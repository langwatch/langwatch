import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import { resolveActiveOrganizationMemberEmails } from "../organizationMemberEmails";

describe("resolveActiveOrganizationMemberEmails", () => {
  it("uses active memberships and non-deactivated users while skipping orphans", async () => {
    const organizationUserFindMany = vi.fn(async () => [
      { userId: "active" },
      { userId: "deactivated" },
      { userId: "orphan" },
    ]);
    const userFindMany = vi.fn(async () => [{ email: " Active@Example.com " }]);
    const prisma = {
      organizationUser: { findMany: organizationUserFindMany },
      user: { findMany: userFindMany },
    } as unknown as PrismaClient;

    await expect(
      resolveActiveOrganizationMemberEmails({ prisma, organizationId: "org" }),
    ).resolves.toEqual(["active@example.com"]);
    expect(organizationUserFindMany).toHaveBeenCalledWith({
      where: { organizationId: "org", disabledAt: null },
      select: { userId: true },
    });
    expect(userFindMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["active", "deactivated", "orphan"] },
        deactivatedAt: null,
        email: { not: null },
      },
      select: { email: true },
    });
  });
});

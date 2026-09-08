import { describe, expect, it, vi } from "vitest";
import { resolveAttributionUserId } from "../langyAttribution";

/**
 * The two reads the resolver makes. Audit columns on ProjectSecret and
 * VirtualKey are foreign keys to User, so whatever this returns must name a
 * User row or the provisioning insert fails on the constraint.
 */
const prismaWith = ({
  users,
  firstAdmin,
}: {
  users: string[];
  firstAdmin: string | null;
}) =>
  ({
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        users.includes(where.id) ? { id: where.id } : null,
      ),
    },
    organizationUser: {
      findFirst: vi.fn(async () =>
        firstAdmin ? { userId: firstAdmin } : null,
      ),
    },
  }) as any;

describe("resolveAttributionUserId", () => {
  it("attributes to the acting user when the id names a user", async () => {
    const prisma = prismaWith({ users: ["user-1"], firstAdmin: "admin-1" });

    await expect(
      resolveAttributionUserId({
        prisma,
        organizationId: "org-1",
        explicitUserId: "user-1",
      }),
    ).resolves.toBe("user-1");
    expect(prisma.organizationUser.findFirst).not.toHaveBeenCalled();
  });

  /** @scenario A service key's first turn attributes provisioning to the organization's first admin */
  it("falls back to the first admin when the actor is a service key, not a user", async () => {
    // A service key acts as itself, so the actor id names an ApiKey row. The
    // audit columns cannot point at it; the first admin is the attribution
    // the backfill path already uses for actorless provisioning.
    const prisma = prismaWith({ users: [], firstAdmin: "admin-1" });

    await expect(
      resolveAttributionUserId({
        prisma,
        organizationId: "org-1",
        explicitUserId: "service-key-1",
      }),
    ).resolves.toBe("admin-1");
  });

  it("falls back to the first admin when no actor is given", async () => {
    const prisma = prismaWith({ users: [], firstAdmin: "admin-1" });

    await expect(
      resolveAttributionUserId({ prisma, organizationId: "org-1" }),
    ).resolves.toBe("admin-1");
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("returns null when neither a user actor nor an admin exists", async () => {
    const prisma = prismaWith({ users: [], firstAdmin: null });

    await expect(
      resolveAttributionUserId({
        prisma,
        organizationId: "org-1",
        explicitUserId: "service-key-1",
      }),
    ).resolves.toBeNull();
  });
});

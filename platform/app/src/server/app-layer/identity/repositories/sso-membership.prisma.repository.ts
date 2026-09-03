import { Prisma, type PrismaClient } from "~/generated/prisma/client";

/**
 * The `OrganizationUser` rows the two single-sign-on sign-in decisions read
 * and write, and the organization row an auto-join announces itself into.
 *
 * `OrganizationUser` is exempt from the multitenancy middleware's
 * organization guard only through the shapes below — each one names an
 * `organizationId` — which is why "is this person a member" is asked here
 * rather than through a `user._count` detour.
 */
export class PrismaSsoMembershipRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findMembership({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<boolean> {
    const membership = await this.prisma.organizationUser.findFirst({
      where: { userId, organizationId },
      select: { userId: true },
    });
    return membership !== null;
  }

  /**
   * Whether this address belongs to the one person the SSO setup exemption is
   * for: the administrator who registered a connection, who is still a member
   * of the organization it belongs to.
   *
   * BOTH HALVES ARE LOAD-BEARING. The address must resolve to `userId` — that
   * is what keeps a colleague's address out of a connection under setup — and
   * `userId` must still be a member here, so a registrant whose membership was
   * revoked stops being able to dial the connection they left behind.
   *
   * Both places an address can live are asked, because the identity work moved
   * the truth to `Identifier` while `User.email` remains a copy for accounts the
   * backfill has not finalized (ADR-101 §5). Asking only one of them would make
   * the setup sign-in work for some administrators and not others.
   */
  async findRegistrantAtAddress({
    organizationId,
    userId,
    email,
  }: {
    organizationId: string;
    userId: string;
    email: string;
  }): Promise<boolean> {
    const address = email.trim().toLowerCase();
    if (!address) return false;
    const membership = await this.prisma.organizationUser.findFirst({
      where: {
        organizationId,
        userId,
        OR: [
          { user: { email: { equals: address, mode: "insensitive" } } },
          {
            user: {
              identifiers: {
                some: { value: address, verifiedAt: { not: null } },
              },
            },
          },
        ],
      },
      select: { userId: true },
    });
    return membership !== null;
  }

  /**
   * Makes somebody a MEMBER of an organization.
   *
   * P2002 (unique constraint) on THIS insert means another concurrent OAuth
   * callback or a retry already created this membership, so it is answered as
   * `"already-present"` rather than raised — idempotent success. The catch
   * guards the membership write alone: a P2002 from any other constraint is a
   * real failure and propagates.
   */
  async createMembership({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<"created" | "already-present"> {
    try {
      await this.prisma.organizationUser.create({
        data: { userId, organizationId, role: "MEMBER" },
      });
      return "created";
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        return "already-present";
      }
      throw err;
    }
  }

  async findOrganizationForMembership({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<{ id: string; name: string } | null> {
    return await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true },
    });
  }
}

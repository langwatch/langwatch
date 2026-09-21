import type { PrismaClient } from "~/generated/prisma/client";
import type {
  RequiringOrganization,
  TwoStepAccountPort,
} from "./two-step-verification.service";

/**
 * What the account side of two-step verification reads.
 *
 * Its own module, apart from the protocol adapter beside it, because that one
 * reaches the two-factor plugin's endpoints on the better-auth instance and
 * better-auth's module imports the composition root. This reads Prisma and
 * nothing else, so keeping it here is what lets the composition root offer it
 * to better-auth without closing that loop.
 *
 * `User.twoFactorEnabled` is the plugin's own column and the one answer to
 * "has this person got one" everywhere in the product — the impersonation
 * guard reads the same field, so an operator and an organization can never
 * disagree about the same person.
 */
export class PrismaTwoStepAccount implements TwoStepAccountPort {
  constructor(private readonly prisma: PrismaClient) {}

  async enrollmentEnabled({ userId }: { userId: string }): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { twoFactorEnabled: true },
    });
    return user?.twoFactorEnabled ?? false;
  }

  async passkeyCount({ userId }: { userId: string }): Promise<number> {
    return this.prisma.passkey.count({ where: { userId } });
  }

  async requiringOrganizations({
    userId,
  }: {
    userId: string;
  }): Promise<readonly RequiringOrganization[]> {
    // Asked of ORGANIZATION rather than of the membership rows, which is the
    // repo's established shape for "the organizations this person belongs to"
    // (see `authz-read.prisma.repository.ts`). A `findMany` over
    // `OrganizationUser` keyed only by `userId` spans every organization at
    // once, so the org-tenancy guard refuses it — and that refusal is a plain
    // Error, which reached this page as an unknown failure and took the whole
    // two-step section down with it.
    const organizations = await this.prisma.organization.findMany({
      where: {
        mfaRequired: true,
        members: { some: { userId, disabledAt: null } },
      },
      select: { id: true, name: true, slug: true },
    });
    return organizations.map((organization) => ({
      organizationId: organization.id,
      name: organization.name,
      slug: organization.slug,
    }));
  }
}

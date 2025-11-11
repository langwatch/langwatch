import type { PrismaClient } from "@prisma/client";
import type { OrganizationWithAdmins } from "../types/organization-repository.types/organization-with-admins";

/**
 * Repository for organization data access
 * Single Responsibility: Query organization and member data
 */
export class OrganizationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Get organization with admin members who have email addresses
   */
  async getOrganizationWithAdmins(
    organizationId: string,
  ): Promise<OrganizationWithAdmins | null> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        id: true,
        name: true,
        members: {
          where: { role: "ADMIN" },
          select: {
            user: {
              select: {
                id: true,
                email: true,
              },
            },
          },
        },
      },
    });

    if (!organization) {
      return null;
    }

    const adminsWithEmail = organization.members
      .filter((member) => member.user.email)
      .map((member) => ({
        userId: member.user.id,
        email: member.user.email!,
      }));

    return {
      id: organization.id,
      name: organization.name,
      admins: adminsWithEmail,
    };
  }
}


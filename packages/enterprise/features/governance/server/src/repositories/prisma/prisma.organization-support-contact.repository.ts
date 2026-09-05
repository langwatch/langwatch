// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { OrganizationSupportContactRepository } from "../organization-support-contact.repository";

/** The client slice the support-contact reads bind to. */
export type OrganizationSupportContactDatabase = Pick<
  PrismaClient,
  "organization" | "organizationUser" | "user"
>;

/** Private Prisma owner for the rows behind "contact your admin". */
export class PrismaOrganizationSupportContactRepository extends OrganizationSupportContactRepository {
  private constructor(private readonly prisma: OrganizationSupportContactDatabase) {
    super();
  }

  static create({
    prisma,
  }: {
    prisma: OrganizationSupportContactDatabase;
  }): PrismaOrganizationSupportContactRepository {
    return new PrismaOrganizationSupportContactRepository(prisma);
  }

  async findAdminUserIds({ organizationId }: { organizationId: string }): Promise<string[]> {
    const admins = await this.prisma.organizationUser.findMany({
      where: { organizationId, role: "ADMIN" },
      select: { userId: true },
      orderBy: { createdAt: "asc" },
    });

    return admins.map((admin) => admin.userId);
  }

  async findEmailsByUserIds({
    userIds,
  }: {
    userIds: string[];
  }): Promise<Map<string, string | null>> {
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, email: true },
    });

    return new Map(users.map((user) => [user.id, user.email]));
  }

  async findConfiguredSupportContact({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<string | null> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { supportContact: true },
    });

    return organization?.supportContact ?? null;
  }
}

// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { NurturingProfileRepository, type NurturingProfile } from "../nurturing-profile.repository";

type Database = Pick<
  PrismaClient,
  "user" | "organizationUser" | "organization" | "project" | "subscription"
>;

export class PrismaNurturingProfileRepository extends NurturingProfileRepository {
  private constructor(private readonly database: Database) {
    super();
  }

  static create(database: Database): PrismaNurturingProfileRepository {
    return new PrismaNurturingProfileRepository(database);
  }

  async tryFindProfile(userId: string): Promise<NurturingProfile | null> {
    const [user, orgUser] = await Promise.all([
      this.database.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, name: true, createdAt: true },
      }),
      this.database.organizationUser.findFirst({
        where: { userId },
        select: { organizationId: true, role: true },
      }),
    ]);
    if (!user || !orgUser) return null;

    const [organization, projects, activeSubscription] = await Promise.all([
      this.database.organization.findUnique({
        where: { id: orgUser.organizationId },
        select: { id: true, name: true, signupData: true },
      }),
      this.database.project.findMany({
        where: { team: { organization: { id: orgUser.organizationId } } },
        select: { firstMessage: true, integrated: true },
      }),
      this.database.subscription.findFirst({
        where: { organizationId: orgUser.organizationId, status: "ACTIVE" },
        select: { id: true },
      }),
    ]);
    if (!organization) return null;

    return {
      user,
      organization: {
        id: organization.id,
        name: organization.name,
        signupData: (organization.signupData ?? {}) as Record<string, unknown>,
      },
      hasTraces: projects.some((project) => project.firstMessage),
      hasSubscription: !!activeSubscription,
    };
  }

  async memberUserIds(organizationId: string): Promise<string[]> {
    const members = await this.database.organizationUser.findMany({
      where: { organizationId },
      select: { userId: true },
    });
    return members.map((member) => member.userId);
  }
}

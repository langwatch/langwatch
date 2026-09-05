// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { PrismaClient } from "@langwatch/prisma-client/generated";
import {
  GovernanceDirectoryPort,
  type GovernanceDirectoryProject,
  type GovernanceMembershipStatus,
} from "../../ports/governance-directory.port";

type Database = Pick<PrismaClient, "user" | "organizationUser" | "project">;

const PROJECT_SELECT = {
  id: true,
  slug: true,
  name: true,
  isPersonal: true,
  ownerUserId: true,
} as const;

export class PrismaGovernanceDirectoryRepository extends GovernanceDirectoryPort {
  private constructor(private readonly database: Database) {
    super();
  }

  static create(database: Database): PrismaGovernanceDirectoryRepository {
    return new PrismaGovernanceDirectoryRepository(database);
  }

  async membershipStatus({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<GovernanceMembershipStatus> {
    const [user, membership] = await Promise.all([
      this.database.user.findUnique({ where: { id: userId }, select: { deactivatedAt: true } }),
      // `disabledAt` is part of the predicate: a seat an admin disabled to
      // reclaim it is not an active membership.
      this.database.organizationUser.findFirst({
        where: { userId, organizationId, disabledAt: null },
        select: { userId: true },
      }),
    ]);
    if (!user) return "user_missing";
    if (user.deactivatedAt !== null) return "user_deactivated";
    return membership ? "active" : "not_org_member";
  }

  async tryFindPersonProfile(
    userId: string,
  ): Promise<{ name: string | null; email: string | null } | null> {
    return await this.database.user.findUnique({
      where: { id: userId },
      select: { name: true, email: true },
    });
  }

  async tryFindOrganizationIdByProjectApiKey(apiKey: string): Promise<string | null> {
    const project = await this.database.project.findUnique({
      where: { apiKey, archivedAt: null },
      select: { team: { select: { organizationId: true } } },
    });
    return project?.team.organizationId ?? null;
  }

  async tryFindMemberIdByEmail({
    email,
    organizationId,
  }: {
    email: string;
    organizationId: string;
  }): Promise<string | null> {
    const user = await this.database.user.findFirst({
      where: { email, orgMemberships: { some: { organizationId } } },
      select: { id: true },
    });
    return user?.id ?? null;
  }

  async tryFindLiveProjectBySlug({
    slug,
    organizationId,
  }: {
    slug: string;
    organizationId: string;
  }): Promise<(GovernanceDirectoryProject & { apiKey: string }) | null> {
    return await this.database.project.findFirst({
      where: { slug, archivedAt: null, team: { organizationId } },
      select: { ...PROJECT_SELECT, apiKey: true },
    });
  }

  async tryFindLiveProjectByRef({
    projectRef,
    organizationId,
  }: {
    projectRef: string;
    organizationId: string;
  }): Promise<GovernanceDirectoryProject | null> {
    const inOrganization = { archivedAt: null, team: { organizationId } };
    return (
      (await this.database.project.findFirst({
        where: { id: projectRef, ...inOrganization },
        select: PROJECT_SELECT,
      })) ??
      (await this.database.project.findFirst({
        where: { slug: projectRef, ...inOrganization },
        select: PROJECT_SELECT,
      }))
    );
  }
}

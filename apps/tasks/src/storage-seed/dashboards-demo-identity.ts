/**
 * The dashboards demo's identity rows, idempotent: one organization, one team, the demo
 * projects with their fixed keys, and an existing user made admin of both. No new users.
 * A project the team holds that the demo no longer lists is archived.
 */
import type { AuthzApi } from "@langwatch/authz-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { nowInstant, toDate } from "@langwatch/time";

import {
  DASHBOARDS_DEMO_ORGANIZATION,
  DASHBOARDS_DEMO_PROJECTS,
  DASHBOARDS_DEMO_TEAM,
} from "./dashboards-demo-ids.ts";
import { adminGrants, attachSeedGrants } from "./seed-authz.ts";
import { resolveOrganizationId, upsertOrganization, upsertTeam } from "./seed-local-rows.ts";

/** The member who sees the demo: by email when given, else the local-dev admin by its address. */
export async function findDemoMember({
  prisma,
  email,
  adminEmail,
}: {
  prisma: PrismaClient;
  email: string | undefined;
  adminEmail: string;
}): Promise<{ id: string; email: string | null }> {
  const user = await prisma.user.findFirst({
    where: { email: email ?? adminEmail },
    select: { id: true, email: true },
  });
  if (!user) {
    throw new Error(
      email
        ? `No user has the email ${email}; sign up once, or set DASHBOARDS_DEMO_USER_EMAIL to an existing user`
        : "The local-dev admin is missing; run the storage seed first, or set DASHBOARDS_DEMO_USER_EMAIL",
    );
  }
  return user;
}

export async function seedDashboardsDemoIdentity({
  prisma,
  authz,
  userId,
}: {
  prisma: PrismaClient;
  /** Attaches the member's admin grants as authz commands; one they hold is skipped. */
  authz: Pick<AuthzApi, "defineRole" | "attachBindings">;
  userId: string;
}): Promise<{ organizationId: string }> {
  const organization = await upsertDemoOrganization({ prisma });
  const team = await upsertTeam({
    prisma,
    slug: DASHBOARDS_DEMO_TEAM.slug,
    name: DASHBOARDS_DEMO_TEAM.name,
    organizationId: organization.id,
  });
  for (const project of DASHBOARDS_DEMO_PROJECTS) {
    const hasTraffic = project.agents.length > 0;
    await prisma.project.upsert({
      where: { id: project.id },
      create: {
        id: project.id,
        name: project.name,
        slug: project.slug,
        apiKey: project.apiKey,
        teamId: team.id,
        language: "python",
        framework: "other",
        firstMessage: hasTraffic,
        integrated: hasTraffic,
      },
      update: {
        name: project.name,
        apiKey: project.apiKey,
        archivedAt: null,
        firstMessage: hasTraffic,
        integrated: hasTraffic,
      },
      select: { id: true },
    });
  }

  await prisma.project.updateMany({
    where: {
      teamId: team.id,
      archivedAt: null,
      id: { notIn: DASHBOARDS_DEMO_PROJECTS.map(({ id }) => id) },
    },
    data: { archivedAt: toDate(nowInstant()) },
  });

  await prisma.organizationUser.upsert({
    where: { userId_organizationId: { userId, organizationId: organization.id } },
    create: { userId, organizationId: organization.id, role: "ADMIN" },
    update: { role: "ADMIN" },
    select: { userId: true },
  });
  await prisma.teamUser.upsert({
    where: { userId_teamId: { userId, teamId: team.id } },
    create: { userId, teamId: team.id, role: "ADMIN" },
    update: { role: "ADMIN" },
    select: { userId: true },
  });
  await attachSeedGrants({
    authz,
    organizationId: organization.id,
    roles: [],
    grants: adminGrants({ organizationId: organization.id, teamId: team.id, userId }),
  });
  return { organizationId: organization.id };
}

async function upsertDemoOrganization({ prisma }: { prisma: PrismaClient }) {
  const { slug, name } = DASHBOARDS_DEMO_ORGANIZATION;
  const id = await resolveOrganizationId({ prisma, slug });
  return upsertOrganization({ prisma, id, slug, name });
}

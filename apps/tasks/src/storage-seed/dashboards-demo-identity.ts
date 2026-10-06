/**
 * The dashboards demo's identity rows, idempotent: one organization, one team, the demo
 * projects with their fixed keys, and an existing user made admin of both. No new users.
 */
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import {
  DASHBOARDS_DEMO_BINDING_IDS,
  DASHBOARDS_DEMO_ORGANIZATION,
  DASHBOARDS_DEMO_PROJECTS,
  DASHBOARDS_DEMO_TEAM,
} from "./dashboards-demo-ids.ts";
import { adminGrantBindings, seedGrantBinding } from "./seed-authz.ts";
import { LOCAL_DEV_ADMIN_USER_ID } from "./seed-identity.ts";

/** The member who sees the demo: by email when given, else the local-dev admin. */
export async function findDemoMember({
  prisma,
  email,
}: {
  prisma: PrismaClient;
  email: string | undefined;
}): Promise<{ id: string; email: string | null }> {
  const user = await prisma.user.findFirst({
    where: email ? { email } : { id: LOCAL_DEV_ADMIN_USER_ID },
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
  userId,
}: {
  prisma: PrismaClient;
  userId: string;
}): Promise<void> {
  const organization = await prisma.organization.upsert({
    where: { id: DASHBOARDS_DEMO_ORGANIZATION.id },
    create: { ...DASHBOARDS_DEMO_ORGANIZATION },
    update: { name: DASHBOARDS_DEMO_ORGANIZATION.name },
    select: { id: true },
  });
  const team = await prisma.team.upsert({
    where: { id: DASHBOARDS_DEMO_TEAM.id },
    create: { ...DASHBOARDS_DEMO_TEAM, organizationId: organization.id },
    update: { name: DASHBOARDS_DEMO_TEAM.name },
    select: { id: true },
  });
  for (const project of DASHBOARDS_DEMO_PROJECTS) {
    const hasTraffic = project.archetype !== undefined;
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
      update: { name: project.name, apiKey: project.apiKey, archivedAt: null },
      select: { id: true },
    });
  }

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
  for (const binding of adminGrantBindings({
    organizationId: organization.id,
    teamId: team.id,
    userId,
    ids: DASHBOARDS_DEMO_BINDING_IDS,
  })) {
    await seedGrantBinding({ prisma, binding });
  }
}

/**
 * The local identity rows the storage seed writes: organization, team, project and users.
 * Each row gets a freshly minted KSUID on create and is found again by slug or email, so no
 * id is shared between two databases (dev/docs/adr/180, section 5).
 */
import { generate } from "@langwatch/ksuid";
import { ORGANIZATION_KSUID_RESOURCE } from "@langwatch/organization-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { USER_KSUID_RESOURCE } from "@langwatch/user-contract";

// Same private resource names as modules/organization/.../organization-provisioning.service.ts:23.
const TEAM_KSUID_RESOURCE = "team";
const PROJECT_KSUID_RESOURCE = "project";

/** The id an organization already holds under this slug, else a fresh one (not yet written). */
export async function resolveOrganizationId({
  prisma,
  slug,
}: {
  prisma: PrismaClient;
  slug: string;
}): Promise<string> {
  const held = await prisma.organization.findUnique({ where: { slug }, select: { id: true } });
  return held?.id ?? generate(ORGANIZATION_KSUID_RESOURCE).toString();
}

/** Found by slug; `id` applies only when the row is created. */
export function upsertOrganization({
  prisma,
  id,
  slug,
  name,
  license,
}: {
  prisma: PrismaClient;
  id: string;
  slug: string;
  name: string;
  /** Left as stored when absent. */
  license?: string | null;
}) {
  return prisma.organization.upsert({
    where: { slug },
    create: { id, name, slug, license },
    update: { license },
  });
}

export function upsertTeam({
  prisma,
  slug,
  name,
  organizationId,
}: {
  prisma: PrismaClient;
  slug: string;
  name: string;
  organizationId: string;
}) {
  return prisma.team.upsert({
    // The slug finds the row; the organization satisfies the tenancy guard.
    where: { slug, organizationId },
    create: { id: generate(TEAM_KSUID_RESOURCE).toString(), name, slug, organizationId },
    update: {},
  });
}

/** An explicit override can also clear the flags; without one, an existing true stays. */
export function upsertProject({
  prisma,
  slug,
  name,
  apiKey,
  teamId,
  isPastOnboarding,
  hasFirstMessageOverride,
}: {
  prisma: PrismaClient;
  slug: string;
  name: string;
  apiKey: string;
  teamId: string;
  isPastOnboarding: boolean;
  hasFirstMessageOverride: boolean;
}) {
  return prisma.project.upsert({
    where: { slug },
    create: {
      id: generate(PROJECT_KSUID_RESOURCE).toString(),
      name,
      slug,
      apiKey,
      teamId,
      language: "en",
      framework: "langchain",
      firstMessage: isPastOnboarding,
      integrated: isPastOnboarding,
    },
    update:
      hasFirstMessageOverride || isPastOnboarding
        ? { apiKey, firstMessage: isPastOnboarding, integrated: isPastOnboarding }
        : { apiKey },
  });
}

/**
 * Found by email, else by `retiredId` (the fixed id an older seed wrote, read only so a database
 * seeded before random ids, or under a retired address, keeps its one account); created with a
 * fresh KSUID when neither exists.
 */
export async function upsertSeedUser({
  prisma,
  email,
  name,
  retiredId,
}: {
  prisma: PrismaClient;
  email: string;
  name: string;
  retiredId: string;
}) {
  const held =
    (await prisma.user.findFirst({ where: { email }, select: { id: true } })) ??
    (await prisma.user.findFirst({ where: { id: retiredId }, select: { id: true } }));
  if (held) return prisma.user.update({ where: { id: held.id }, data: { email } });
  return prisma.user.create({
    data: { id: generate(USER_KSUID_RESOURCE).toString(), email, name, emailVerified: true },
  });
}

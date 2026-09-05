import type { PrismaClient } from "~/generated/prisma/client";

/** Resolve deliverable member addresses without joining an orphanable relation. */
export async function resolveActiveOrganizationMemberEmails({
  prisma,
  organizationId,
}: {
  prisma: PrismaClient;
  organizationId: string;
}): Promise<string[]> {
  const memberships = await prisma.organizationUser.findMany({
    where: { organizationId, disabledAt: null },
    select: { userId: true },
  });
  if (memberships.length === 0) return [];

  const users = await prisma.user.findMany({
    where: {
      id: { in: memberships.map(({ userId }) => userId) },
      deactivatedAt: null,
      email: { not: null },
    },
    select: { email: true },
  });
  return users.flatMap(({ email }) =>
    email ? [email.trim().toLowerCase()] : [],
  );
}

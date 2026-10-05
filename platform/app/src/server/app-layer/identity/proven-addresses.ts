import type { PrismaClient } from "~/generated/prisma/client";
import { identityEmail } from "./runtime";

/**
 * Every address a person has PROVEN, read the one way both doors read it.
 *
 * Identifiers answer first. A user not on identifiers yet keeps the legacy
 * `User.email` column, counted only where better-auth marked it verified; an
 * unverified address answers nothing. The join door and the invitation
 * lookup both decide on this list, and reading it in two places once let the
 * automatic door admit somebody whose invitation the other read could not
 * see, so the rule lives here and nowhere else.
 */
export async function provenAddressesOf({
  prisma,
  userId,
}: {
  prisma: PrismaClient;
  userId: string;
}): Promise<string[]> {
  const proven = await identityEmail().verifiedEmailsOf({ userId });
  if (proven !== null) return proven.map(({ value }) => value);

  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, emailVerified: true },
  });
  return row?.emailVerified && row.email ? [row.email] : [];
}

import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type { IdentityRepositories } from "../../repositories/identity.repositories.ts";
import { PostgresIdentityRepositories } from "../../repositories/prisma/prisma.identity.repositories.ts";

/** The live tier over a test's Prisma double, as the registry builds it for a process. */
export function liveRepositories(
  prisma: PrismaClient,
  adminEmails: readonly string[] = [],
): IdentityRepositories {
  return PostgresIdentityRepositories.create({
    prisma,
    encryption: { encrypt: (value) => value, decrypt: (value) => value },
    adminEmails,
  });
}

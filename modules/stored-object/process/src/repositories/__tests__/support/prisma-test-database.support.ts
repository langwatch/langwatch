/**
 * The Postgres half of the stored-object repository contracts. It runs only when
 * LANGWATCH_TEST_DATABASE_URL names a migrated database, and empties the tenants it is given
 * before each case, so every case starts from the same blank rows the memory backend does.
 */
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

type PrismaTestClient = ReturnType<
  ReturnType<typeof PrismaConnectionService.create>["connect"]
>["client"];

/** The connected client, or none when no test database is configured. */
export function findPrismaTestClients(): PrismaTestClient[] {
  if (!DB_URL) return [];
  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:stored-object:test:prisma"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL, log: ["error"] }));

  return [connection.client];
}

/** Deletes every stored-object row and owner link the named tenants hold. */
export async function emptyTenants({
  prisma,
  tenantIds,
}: {
  prisma: PrismaTestClient;
  tenantIds: readonly string[];
}): Promise<void> {
  for (const tenantId of tenantIds) {
    await prisma.storedObjectOwner.deleteMany({ where: { tenantId } });
    await prisma.storedObject.deleteMany({ where: { tenantId } });
  }
}

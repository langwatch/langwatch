import { randomBytes } from "node:crypto";
import type { PrismaClient } from "~/generated/prisma/client";

/**
 * Mint `User.userHashKey` (ADR-101 §4) when the user has none. Guarded: a
 * key minted concurrently — by the adapter at user creation, by another
 * backfill pass — is never overwritten, because rewriting it would orphan
 * every identifier hash already computed with the old key.
 */
export async function mintUserHashKeyIfMissing({
  prisma,
  userId,
}: {
  prisma: Pick<PrismaClient, "user">;
  userId: string;
}): Promise<void> {
  await prisma.user.updateMany({
    where: { id: userId, userHashKey: null },
    data: { userHashKey: randomBytes(32).toString("hex") },
  });
}

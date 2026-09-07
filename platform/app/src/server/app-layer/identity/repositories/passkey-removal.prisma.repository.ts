import type { IdentityUserGate } from "@langwatch/identity-server";
import type {
  PasskeyRemovalOutcome,
  PasskeyRemovalPort,
} from "@langwatch/identity-server/better-auth";
import { z } from "zod";
import { Prisma, type PrismaClient } from "~/generated/prisma/client";
import { isUsableCredential } from "../../../users/credential-user";

const MAX_SERIALIZATION_ATTEMPTS = 4;

const driverWriteConflictSchema = z.object({
  name: z.literal("DriverAdapterError"),
  cause: z.object({ kind: z.literal("TransactionWriteConflict") }),
});

function isSerializationConflict(error: unknown): boolean {
  return (
    (error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2034") ||
    driverWriteConflictSchema.safeParse(error).success
  );
}

export interface PrismaPasskeyRemovalRepositoryDeps {
  prisma: Pick<PrismaClient, "$transaction">;
  routesToIdentity: IdentityUserGate;
}

/**
 * Deletes one passkey only while another usable sign-in method survives.
 * The decision and deletion share a SERIALIZABLE transaction so concurrent
 * removals cannot both decide from the same stale set of passkeys.
 */
export class PrismaPasskeyRemovalRepository implements PasskeyRemovalPort {
  private constructor(
    private readonly deps: PrismaPasskeyRemovalRepositoryDeps,
  ) {}

  static create(
    deps: PrismaPasskeyRemovalRepositoryDeps,
  ): PrismaPasskeyRemovalRepository {
    return new PrismaPasskeyRemovalRepository(deps);
  }

  async deleteIfAnotherWayInRemains({
    passkeyId,
  }: {
    passkeyId: string;
  }): Promise<PasskeyRemovalOutcome> {
    for (let attempt = 0; attempt < MAX_SERIALIZATION_ATTEMPTS; attempt++) {
      try {
        return await this.deleteOnce(passkeyId);
      } catch (error) {
        if (
          attempt + 1 < MAX_SERIALIZATION_ATTEMPTS &&
          isSerializationConflict(error)
        ) {
          continue;
        }
        throw error;
      }
    }
    throw new Error("unreachable: passkey removal retries exhausted");
  }

  private async deleteOnce(passkeyId: string): Promise<PasskeyRemovalOutcome> {
    return await this.deps.prisma.$transaction(
      (tx) => this.deleteInTransaction({ tx, passkeyId }),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private async deleteInTransaction({
    tx,
    passkeyId,
  }: {
    tx: Prisma.TransactionClient;
    passkeyId: string;
  }): Promise<PasskeyRemovalOutcome> {
    const target = await tx.passkey.findUnique({
      where: { id: passkeyId },
      select: { userId: true },
    });
    if (target === null) return "not_found";

    const identityCredentials = await this.deps.routesToIdentity({
      userId: target.userId,
    });
    const [otherPasskeys, credentials] = await Promise.all([
      tx.passkey.count({
        where: { userId: target.userId, id: { not: passkeyId } },
      }),
      identityCredentials
        ? tx.accountCredential.findMany({
            where: { userId: target.userId },
            select: { provider: true, password: true },
          })
        : tx.account.findMany({
            where: { userId: target.userId },
            select: { provider: true, password: true },
          }),
    ]);
    if (otherPasskeys === 0 && !credentials.some(isUsableCredential)) {
      return "would_strand_user";
    }

    const deleted = await tx.passkey.deleteMany({
      where: { id: passkeyId, userId: target.userId },
    });
    return deleted.count === 0 ? "not_found" : "deleted";
  }
}

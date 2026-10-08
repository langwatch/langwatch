import { withSerializationRetry } from "@langwatch/prisma-client";
import { Prisma, type PrismaClient } from "@langwatch/prisma-client/generated";

import type { IdentityUserGate } from "../../rules/identity-user-gate.rules.ts";
import {
  IdentityPasskeyRemovalRepository,
  type PasskeyRemovalOutcome,
} from "../identity-passkey-removal.repository.ts";

type PrismaPasskeyRemovalDatabase = Pick<PrismaClient, "$transaction">;

/** A credential row with an empty password is a ceremony that never finished. */
const isUsableCredential = (row: { provider: string; password: string | null }): boolean =>
  row.provider !== "credential" || (typeof row.password === "string" && row.password.length > 0);

export class PrismaIdentityPasskeyRemovalRepository extends IdentityPasskeyRemovalRepository {
  static create(database: PrismaPasskeyRemovalDatabase): PrismaIdentityPasskeyRemovalRepository {
    return new PrismaIdentityPasskeyRemovalRepository(database);
  }

  private constructor(private readonly database: PrismaPasskeyRemovalDatabase) {
    super();
  }

  async deleteIfAnotherWayInRemains({
    passkeyId,
    routesToIdentity,
  }: {
    passkeyId: string;
    routesToIdentity: IdentityUserGate;
  }): Promise<PasskeyRemovalOutcome> {
    return withSerializationRetry(() =>
      this.database.$transaction(
        (tx) => this.deleteInTransaction({ tx, passkeyId, routesToIdentity }),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  private async deleteInTransaction({
    tx,
    passkeyId,
    routesToIdentity,
  }: {
    tx: Prisma.TransactionClient;
    passkeyId: string;
    routesToIdentity: IdentityUserGate;
  }): Promise<PasskeyRemovalOutcome> {
    const target = await tx.passkey.findUnique({
      where: { id: passkeyId },
      select: { userId: true },
    });
    if (target === null) return "not_found";
    const { userId } = target;
    const latched = await routesToIdentity({ userId });
    const credentialSelect = { provider: true, password: true } as const;
    const [otherPasskeys, credentials] = await Promise.all([
      tx.passkey.count({ where: { userId, id: { not: passkeyId } } }),
      latched
        ? tx.accountCredential.findMany({ where: { userId }, select: credentialSelect })
        : tx.account.findMany({ where: { userId }, select: credentialSelect }),
    ]);
    if (otherPasskeys === 0 && !credentials.some(isUsableCredential)) return "would_strand_user";
    const deleted = await tx.passkey.deleteMany({ where: { id: passkeyId, userId } });
    return deleted.count === 0 ? "not_found" : "deleted";
  }
}

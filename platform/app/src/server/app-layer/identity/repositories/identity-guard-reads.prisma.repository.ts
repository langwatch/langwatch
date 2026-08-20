import type { PrismaClient } from "~/generated/prisma/client";
import type { IdentityGuardReads } from "~/server/event-sourcing/pipelines/identity/commands/identityCommands";
import type { IdentityLedgerState } from "~/server/event-sourcing/pipelines/identity/projections/reduceIdentity";
import { identifierProviderSchema } from "~/server/event-sourcing/pipelines/identity/schemas/events";

/**
 * How the identity pipeline's command guards see current state (ADR-101 §2):
 * Postgres reads over the `Identifier` projection and `User.userHashKey`.
 * On the adapter's calling-path dispatch these are read-your-writes; on the
 * staged path they run under the queue's per-user FIFO.
 */
export class PrismaIdentityGuardReads implements IdentityGuardReads {
  constructor(private readonly prisma: PrismaClient) {}

  async getUserHashKey({ userId }: { userId: string }): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { userHashKey: true },
    });
    return user?.userHashKey ?? null;
  }

  async findActiveIdentifierByValue({
    normalizedValue,
  }: {
    normalizedValue: string;
  }): Promise<{ userId: string; identifierId: string } | null> {
    const row = await this.prisma.identifier.findFirst({
      where: {
        value: normalizedValue,
        state: { in: ["VERIFIED", "PRIMARY"] },
      },
      select: { id: true, userId: true },
    });
    return row === null ? null : { userId: row.userId, identifierId: row.id };
  }

  async loadIdentityState({
    userId,
  }: {
    userId: string;
  }): Promise<IdentityLedgerState> {
    const rows = await this.prisma.identifier.findMany({ where: { userId } });
    return {
      userId,
      identifiers: Object.fromEntries(
        rows.map((row) => [
          row.id,
          {
            identifierId: row.id,
            userId: row.userId,
            provider: identifierProviderSchema.parse(row.provider),
            value: row.value,
            domain: row.domain,
            identifierHash: row.identifierHash,
            accountId: row.accountId,
            connectionId: row.connectionId,
            state:
              row.state as IdentityLedgerState["identifiers"][string]["state"],
            verifiedAtMs: row.verifiedAt?.getTime() ?? null,
            attachedAtMs: row.attachedAt.getTime(),
            detachedAtMs: row.detachedAt?.getTime() ?? null,
          },
        ]),
      ),
    };
  }
}

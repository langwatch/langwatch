import type { PrismaClient } from "@langwatch/prisma-client/generated";

import { transportsOf } from "../../rules/passkey-transports.rules.ts";
import { PasskeyRepository, type StoredPasskey } from "../passkey.repository.ts";

const passkeySelect = {
  id: true,
  userId: true,
  credentialID: true,
  publicKey: true,
  counter: true,
  transports: true,
} as const;

type PasskeyRow = {
  id: string;
  userId: string;
  credentialID: string;
  publicKey: string;
  counter: number;
  transports: string | null;
};

function storedPasskey(row: PasskeyRow): StoredPasskey {
  return {
    id: row.id,
    userId: row.userId,
    credentialId: row.credentialID,
    publicKey: row.publicKey,
    counter: row.counter,
    transports: transportsOf(row.transports),
  };
}

/** The Prisma-backed {@link PasskeyRepository}. */
export class PrismaPasskeyRepository extends PasskeyRepository {
  static create(prisma: PrismaClient): PrismaPasskeyRepository {
    return new PrismaPasskeyRepository(prisma);
  }

  private constructor(private readonly prisma: PrismaClient) {
    super();
  }

  async findForUser({ userId }: { userId: string }): Promise<StoredPasskey[]> {
    const rows = await this.prisma.passkey.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: passkeySelect,
    });
    return rows.map(storedPasskey);
  }

  async findByCredentialId({ credentialId }: { credentialId: string }): Promise<StoredPasskey[]> {
    const rows = await this.prisma.passkey.findMany({
      where: { credentialID: credentialId },
      select: passkeySelect,
    });
    return rows.map(storedPasskey);
  }

  async advanceCounter({ id, counter }: { id: string; counter: number }): Promise<void> {
    await this.prisma.passkey.updateMany({
      where: { id, counter: { lt: counter } },
      data: { counter },
    });
  }
}

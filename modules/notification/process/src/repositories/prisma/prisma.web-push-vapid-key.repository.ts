import { PrismaRepository, type PrismaRepositoryClient } from "@langwatch/prisma-client";

import type { VapidKeyPair, WebPushVapidKeyRepository } from "../web-push-vapid-key.repository.ts";

/** The fixed id that keeps the table at one row. */
const INSTALLATION_ROW_ID = "self";

/** The process's cipher for a stored secret. */
export interface VapidKeyCipher {
  encrypt(plaintext: string): string;
  decrypt(ciphertext: string): string;
}

export type VapidKeyDatabase = PrismaRepositoryClient<readonly ["WebPushVapidKey"]>;

export class PrismaWebPushVapidKeyRepository
  extends PrismaRepository.for("WebPushVapidKey")
  implements WebPushVapidKeyRepository
{
  static create(input: {
    prisma: VapidKeyDatabase;
    cipher: VapidKeyCipher;
  }): PrismaWebPushVapidKeyRepository {
    return new PrismaWebPushVapidKeyRepository(input.prisma, input.cipher);
  }

  #cipher: VapidKeyCipher;

  private constructor(prisma: VapidKeyDatabase, cipher: VapidKeyCipher) {
    super(prisma);
    this.#cipher = cipher;
  }

  async find(): Promise<VapidKeyPair | null> {
    const row = await this.prisma.webPushVapidKey.findUnique({
      where: { id: INSTALLATION_ROW_ID },
    });
    if (!row) return null;
    return { publicKey: row.publicKey, privateKey: this.#cipher.decrypt(row.privateKeyEncrypted) };
  }

  async insertIfAbsent(pair: VapidKeyPair): Promise<VapidKeyPair> {
    await this.prisma.webPushVapidKey.createMany({
      data: [
        {
          id: INSTALLATION_ROW_ID,
          publicKey: pair.publicKey,
          privateKeyEncrypted: this.#cipher.encrypt(pair.privateKey),
        },
      ],
      skipDuplicates: true,
    });
    const stored = await this.find();
    if (!stored) throw new Error("The VAPID key pair was inserted but could not be read back");
    return stored;
  }
}

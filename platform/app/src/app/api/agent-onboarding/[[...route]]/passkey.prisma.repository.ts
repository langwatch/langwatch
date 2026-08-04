import type {
  PasskeyCredential,
  PasskeyRepository,
} from "@langwatch/ai-onboarding";
import type { PrismaClient } from "@prisma/client";

/**
 * The Prisma half of `PasskeyRepository`. In the app for the same reason as
 * the account repository: the client is generated from this app's schema.
 */
export class PrismaPasskeyRepository implements PasskeyRepository {
  constructor(private readonly prisma: PrismaClient) {}

  static create(prisma: PrismaClient): PrismaPasskeyRepository {
    return new PrismaPasskeyRepository(prisma);
  }

  async create(params: {
    userId: string;
    label: string | null;
    credential: PasskeyCredential;
  }): Promise<void> {
    await this.prisma.passkey.create({
      data: {
        userId: params.userId,
        name: params.label,
        credentialId: params.credential.credentialId,
        publicKey: Buffer.from(params.credential.publicKey),
        counter: params.credential.counter,
        deviceType: params.credential.deviceType,
        backedUp: params.credential.backedUp,
        // Stored as a flat list because it is display/hint data the browser
        // hands back verbatim, never something we query on.
        transports: params.credential.transports?.join(",") ?? null,
      },
    });
  }

  async countForUser(userId: string): Promise<number> {
    return this.prisma.passkey.count({ where: { userId } });
  }
}

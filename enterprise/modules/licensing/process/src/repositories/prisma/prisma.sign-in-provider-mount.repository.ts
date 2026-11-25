import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type {
  SignInProviderMount,
  SignInProviderMountRepository,
} from "../sign-in-provider-mount.repository.ts";

/** The fixed key, so the table holds exactly one row. */
const ROW_ID = "self";

type SignInProviderMountDatabase = Pick<PrismaClient, "signInProviderMount">;

export class PrismaSignInProviderMountRepository implements SignInProviderMountRepository {
  static create(database: SignInProviderMountDatabase): PrismaSignInProviderMountRepository {
    return new PrismaSignInProviderMountRepository(database);
  }

  private constructor(private readonly prisma: SignInProviderMountDatabase) {}

  async find(): Promise<readonly SignInProviderMount[]> {
    const row = await this.prisma.signInProviderMount.findUnique({ where: { id: ROW_ID } });
    if (!row) return [];
    return [
      { provider: row.provider, mounted: row.mounted, lastAppliedEventId: row.lastAppliedEventId },
    ];
  }

  async save({ provider, mounted, lastAppliedEventId }: SignInProviderMount): Promise<void> {
    const data = { provider, mounted, lastAppliedEventId };
    await this.prisma.signInProviderMount.upsert({
      where: { id: ROW_ID },
      create: { id: ROW_ID, ...data },
      update: data,
    });
  }
}

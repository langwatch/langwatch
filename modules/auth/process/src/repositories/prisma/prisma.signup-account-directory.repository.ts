import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type { SignUpAccountDirectory } from "../../services/signup-verification.service.ts";

/**
 * Address lookup, case-insensitive to match legacy rows and prevent case-twin
 * duplicates. Unregistered: User table belongs to user module (ADR-133).
 */
export class PrismaSignUpAccountDirectoryRepository implements SignUpAccountDirectory {
  private constructor(private readonly prisma: PrismaClient) {}

  static create(options: { prisma: PrismaClient }): PrismaSignUpAccountDirectoryRepository {
    return new PrismaSignUpAccountDirectoryRepository(options.prisma);
  }

  async hasAccountFor({ email }: { email: string }): Promise<boolean> {
    const user = await this.prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { id: true },
    });

    return user !== null;
  }

  /**
   * The link came back, so the address is proven. Case-insensitive for the same
   * reason the lookup above is.
   */
  async markAddressConfirmed({ email }: { email: string }): Promise<void> {
    await this.prisma.user.updateMany({
      where: { email: { equals: email, mode: "insensitive" } },
      data: { emailVerified: true },
    });
  }
}

// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type {
  SignInLinkCandidate,
  SignInLinkEvidenceRepository,
} from "~/server/app-layer/identity/signin-link-evidence";
import type {
  SsoTestSignIn,
  SsoTestSignInLookup,
} from "./sso-self-serve.service";
import type { SsoTestArrivalAccountsPort } from "./sso-test-arrival.service";

interface SsoAccountFactsPrisma {
  account: {
    count(args: { where: { userId: string } }): Promise<number>;
    findMany(args: {
      where: { userId: string };
      select: { provider: true };
      orderBy: { createdAt: "desc" };
    }): Promise<{ provider: string }[]>;
    findFirst(args: {
      where: { provider: string };
      select: { id: true; userId: true; createdAt: true };
      orderBy: { createdAt: "desc" };
    }): Promise<{ id: string; userId: string; createdAt: Date } | null>;
  };
  user: {
    findUnique(args: {
      where: { id: string };
      select: { emailVerified: true };
    }): Promise<{ emailVerified: boolean } | null>;
  };
  ssoConnection: {
    findFirst(args: {
      where: { id: string; organizationId: string };
      select: { id: true };
    }): Promise<{ id: string } | null>;
  };
}

/** Native Better Auth Account facts shared by the identity callback readers. */
export class PrismaSsoAccountFactsRepository
  implements
    SignInLinkEvidenceRepository,
    SsoTestArrivalAccountsPort,
    SsoTestSignInLookup
{
  readonly #prisma: SsoAccountFactsPrisma;

  constructor(prisma: SsoAccountFactsPrisma) {
    this.#prisma = prisma;
  }

  async countForUser({ userId }: { userId: string }): Promise<number> {
    return await this.#prisma.account.count({ where: { userId } });
  }

  async findAccountProvidersForUser({
    userId,
  }: {
    userId: string;
  }): Promise<readonly string[]> {
    const accounts = await this.#prisma.account.findMany({
      where: { userId },
      select: { provider: true },
      orderBy: { createdAt: "desc" },
    });
    return accounts.map((account) => account.provider);
  }

  async findCandidate({
    userId,
  }: {
    userId: string;
  }): Promise<SignInLinkCandidate | null> {
    const [user, attachedAccounts] = await Promise.all([
      this.#prisma.user.findUnique({
        where: { id: userId },
        select: { emailVerified: true },
      }),
      this.#prisma.account.count({ where: { userId } }),
    ]);
    if (!user) return null;

    return { holdsVerifiedEmail: user.emailVerified, attachedAccounts };
  }

  async findLatestForConnection({
    organizationId,
    connectionId,
  }: {
    organizationId: string;
    connectionId: string;
  }): Promise<SsoTestSignIn | null> {
    const connection = await this.#prisma.ssoConnection.findFirst({
      where: { id: connectionId, organizationId },
      select: { id: true },
    });
    if (!connection) return null;

    const account = await this.#prisma.account.findFirst({
      where: { provider: connectionId },
      select: { id: true, userId: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    if (!account) return null;

    return {
      accountId: account.id,
      userId: account.userId,
      atMs: account.createdAt.getTime(),
    };
  }
}

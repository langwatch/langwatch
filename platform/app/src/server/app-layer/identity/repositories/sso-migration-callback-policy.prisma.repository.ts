import { extractEmailDomain, isSsoProviderMatch } from "@ee/sso/matching";
import {
  normalizeDomain,
  qualifySsoDomainOwnership,
  ssoDomainVerificationSchema,
  ssoIdpMetadataSchema,
} from "@langwatch/identity";
import type { Prisma, PrismaClient } from "~/generated/prisma/client";
import type { DatabaseHookSsoMigrationPort } from "~/server/better-auth/hooks";

const DIRECT_CALLBACK_MARKERS = ["/sso/callback/", "/sso/saml2/sp/acs/"];

/** Better Auth's migration callback policy, backed only by persisted facts. */
export class PrismaSsoMigrationCallbackPolicy
  implements DatabaseHookSsoMigrationPort
{
  constructor(
    private readonly prisma: PrismaClient,
    private readonly newActivityId: () => string,
  ) {}

  async decideAccountLink(args: {
    userId: string;
    providerId: string;
    accountId: string;
  }) {
    const context = await this.contextForUser(this.prisma, args.userId);
    if (context.kind !== "ready") {
      if (context.kind !== "not_migrating") return context.decision;
      return await this.decideStandaloneLegacyConnection(args);
    }

    const matching = context.pairs.filter(({ legacy, replacement }) =>
      this.accountMatchesPair({ account: args, legacy, replacement }),
    );
    if (matching.length === 0) {
      return {
        kind: "reject",
        code: "SSO_MIGRATION_LINK_NOT_ALLOWED",
      } as const;
    }
    if (matching.length > 1) {
      return { kind: "reject", code: "SSO_MIGRATION_LINK_AMBIGUOUS" } as const;
    }

    const pair = matching[0];
    if (!pair) {
      return { kind: "reject", code: "SSO_MIGRATION_LINK_AMBIGUOUS" } as const;
    }
    const direct = args.providerId === pair.replacement.id;
    if (
      !direct &&
      legacyAuthenticationIsRetired(pair.replacement.migrationPhase)
    ) {
      return { kind: "reject", code: "SSO_LEGACY_AUTH_RETIRED" } as const;
    }
    const accounts = await this.prisma.account.findMany({
      where: { userId: args.userId, provider: { not: "credential" } },
      select: { provider: true, providerAccountId: true },
    });
    const pairAccounts = accounts.filter((account) =>
      this.accountMatchesPair({
        account: {
          providerId: account.provider,
          accountId: account.providerAccountId,
        },
        legacy: pair.legacy,
        replacement: pair.replacement,
      }),
    );
    const exactAccounts = new Map<
      string,
      { providerId: string; accountId: string }
    >();
    for (const account of [args, ...pairAccounts.map(toHookAccount)]) {
      exactAccounts.set(
        `${account.providerId}\u0000${account.accountId}`,
        account,
      );
    }
    if (exactAccounts.size > 2) {
      return { kind: "reject", code: "SSO_MIGRATION_LINK_AMBIGUOUS" } as const;
    }

    const keepAccounts = [...exactAccounts.values()];
    const first = keepAccounts[0];
    if (!first) {
      return {
        kind: "reject",
        code: "SSO_MIGRATION_LINK_NOT_ALLOWED",
      } as const;
    }
    const second = keepAccounts[1] ?? first;
    return {
      kind: "allow_replacement_pair",
      arrivalConnectionId: direct ? pair.replacement.id : pair.legacy.id,
      keepAccounts: [first, second],
    } as const;
  }

  async authorizeAndRecordAuthentication({
    userId,
    path,
    authenticatedAt,
  }: {
    userId: string;
    path: string | undefined;
    authenticatedAt: Date;
  }) {
    const callback = ssoCallbackProviderFromPath(path);
    if (!callback) return { action: "continue" } as const;

    return await this.prisma.$transaction(
      async (tx) => {
        const context = await this.contextForUser(tx, userId);
        if (context.kind === "not_migrating") {
          return { action: "continue" } as const;
        }

        const accounts = await tx.account.findMany({
          where: { userId, provider: { not: "credential" } },
          select: { provider: true, providerAccountId: true },
        });
        if (context.kind !== "ready") {
          const applicable = context.pairs.some((pair) =>
            this.callbackMatchesPair({ callback, accounts, pair }),
          );
          return applicable
            ? ({
                action: "reject",
                code: "SSO_MIGRATION_AUTH_NOT_ALLOWED",
              } as const)
            : ({ action: "continue" } as const);
        }
        const matches: Array<{
          connection: { id: string; organizationId: string };
          legacy: boolean;
        }> = [];
        for (const pair of context.pairs) {
          if (callback.kind === "direct") {
            if (callback.providerId === pair.replacement.id) {
              matches.push({ connection: pair.replacement, legacy: false });
            }
            continue;
          }
          const legacyAccount = accounts.some((account) =>
            legacyCallbackMatches({
              callbackProviderId: callback.providerId,
              legacyProviderId: pair.legacy.providerId,
              account,
            }),
          );
          if (legacyAccount) {
            matches.push({ connection: pair.legacy, legacy: true });
          }
        }
        const namesLegacyMigration = context.pairs.some(
          ({ legacy }) =>
            callback.kind === "legacy" &&
            accounts.some((account) =>
              legacyCallbackMatches({
                callbackProviderId: callback.providerId,
                legacyProviderId: legacy.providerId,
                account,
              }),
            ),
        );
        if (matches.length > 1) {
          return {
            action: "reject",
            code: "SSO_MIGRATION_AUTH_AMBIGUOUS",
          } as const;
        }
        if (matches.length === 0) {
          return namesLegacyMigration
            ? ({
                action: "reject",
                code: "SSO_MIGRATION_AUTH_NOT_ALLOWED",
              } as const)
            : ({ action: "continue" } as const);
        }

        const match = matches[0];
        if (!match) return { action: "continue" } as const;
        const pair = context.pairs.find(
          ({ legacy, replacement }) =>
            legacy.id === match.connection.id ||
            replacement.id === match.connection.id,
        );
        if (!pair) return { action: "continue" } as const;
        if (
          match.legacy &&
          legacyAuthenticationIsRetired(pair.replacement.migrationPhase)
        ) {
          return { action: "reject", code: "SSO_LEGACY_AUTH_RETIRED" } as const;
        }

        await tx.ssoAuthenticationActivity.create({
          data: {
            id: this.newActivityId(),
            organizationId: match.connection.organizationId,
            connectionId: match.connection.id,
            userId,
            authenticatedAt,
          },
        });
        return { action: "continue" } as const;
      },
      { isolationLevel: "Serializable" },
    );
  }

  private async contextForUser(
    reads: PrismaClient | Prisma.TransactionClient,
    userId: string,
  ) {
    const user = await reads.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        emailVerified: true,
        orgMemberships: { select: { organizationId: true } },
      },
    });
    if (!user) {
      return {
        kind: "not_migrating",
        decision: { kind: "not_migrating" } as const,
      } as const;
    }
    const organizationIds = user.orgMemberships.map(
      ({ organizationId }) => organizationId,
    );
    const replacements = await reads.ssoConnection.findMany({
      where: {
        organizationId: { in: organizationIds },
        replacesConnectionId: { not: null },
        migrationPhase: { not: null },
        state: { notIn: ["DISCARDED", "TORN_DOWN"] },
      },
      select: {
        id: true,
        organizationId: true,
        replacesConnectionId: true,
        migrationPhase: true,
        verifiedDomains: true,
        domainVerifications: true,
      },
    });
    const predecessorIds = replacements.flatMap(({ replacesConnectionId }) =>
      replacesConnectionId ? [replacesConnectionId] : [],
    );
    const predecessors = await reads.ssoConnection.findMany({
      where: {
        id: { in: predecessorIds },
        source: "legacy-grandfathered",
      },
      select: { id: true, organizationId: true, idpMetadata: true },
    });
    const pairs = replacements.flatMap((replacement) => {
      const predecessor = predecessors.find(
        (candidate) =>
          candidate.id === replacement.replacesConnectionId &&
          candidate.organizationId === replacement.organizationId,
      );
      if (!predecessor) return [];
      const metadata = ssoIdpMetadataSchema.safeParse(predecessor.idpMetadata);
      if (!metadata.success) return [];
      return [
        {
          replacement,
          legacy: { ...predecessor, providerId: metadata.data.providerId },
        },
      ];
    });
    if (pairs.length === 0) {
      return {
        kind: "not_migrating",
        decision: { kind: "not_migrating" } as const,
      } as const;
    }
    if (!user.email || !user.emailVerified) {
      return {
        kind: "unverified",
        pairs,
        decision: {
          kind: "reject",
          code: "SSO_MIGRATION_LINK_UNVERIFIED",
        } as const,
      } as const;
    }
    const matchingUsers = await reads.user.count({
      where: { email: { equals: user.email, mode: "insensitive" } },
    });
    if (matchingUsers !== 1) {
      return {
        kind: "ambiguous",
        pairs,
        decision: {
          kind: "reject",
          code: "SSO_MIGRATION_LINK_AMBIGUOUS",
        } as const,
      } as const;
    }
    const rawDomain = extractEmailDomain(user.email);
    if (!rawDomain) {
      return {
        kind: "unproved",
        pairs,
        decision: {
          kind: "reject",
          code: "SSO_MIGRATION_LINK_NOT_ALLOWED",
        } as const,
      } as const;
    }
    const domain = normalizeDomain(rawDomain);
    const qualifiedPairs = pairs.filter(({ replacement }) => {
      const parsed = ssoDomainVerificationSchema
        .array()
        .safeParse(replacement.domainVerifications);
      const domainVerifications = parsed.success ? parsed.data : [];
      return (
        qualifySsoDomainOwnership({
          state: {
            verifiedDomains: replacement.verifiedDomains,
            domainVerifications,
          },
          domain,
        }).status === "QUALIFIED"
      );
    });
    if (qualifiedPairs.length === 0) {
      return {
        kind: "unproved",
        pairs,
        decision: {
          kind: "reject",
          code: "SSO_MIGRATION_LINK_NOT_ALLOWED",
        } as const,
      } as const;
    }
    return { kind: "ready", pairs: qualifiedPairs } as const;
  }

  private async decideStandaloneLegacyConnection(args: {
    userId: string;
    providerId: string;
    accountId: string;
  }) {
    const user = await this.prisma.user.findUnique({
      where: { id: args.userId },
      select: { email: true, emailVerified: true },
    });
    const rawDomain = extractEmailDomain(user?.email);
    if (!user?.emailVerified || !rawDomain) {
      return { kind: "not_migrating" } as const;
    }
    const domain = normalizeDomain(rawDomain);
    const ownership = await this.prisma.ssoVerifiedDomain.findUnique({
      where: { domain },
      select: { organizationId: true },
    });
    if (!ownership) return { kind: "not_migrating" } as const;
    const holders = await this.prisma.ssoVerifiedDomainHolder.findMany({
      where: { domain, organizationId: ownership.organizationId },
      select: { connectionId: true },
    });
    const connections = await this.prisma.ssoConnection.findMany({
      where: {
        id: { in: holders.map(({ connectionId }) => connectionId) },
        organizationId: ownership.organizationId,
        source: "legacy-grandfathered",
        state: "ACTIVE",
      },
      select: {
        id: true,
        idpMetadata: true,
        verifiedDomains: true,
        domainVerifications: true,
      },
    });
    const matching = connections.filter((connection) => {
      const metadata = ssoIdpMetadataSchema.safeParse(connection.idpMetadata);
      const parsed = ssoDomainVerificationSchema
        .array()
        .safeParse(connection.domainVerifications);
      const domainVerifications = parsed.success ? parsed.data : [];
      return (
        metadata.success &&
        qualifySsoDomainOwnership({
          state: {
            verifiedDomains: connection.verifiedDomains,
            domainVerifications,
          },
          domain,
        }).status === "QUALIFIED" &&
        isSsoProviderMatch({ ssoProvider: metadata.data.providerId }, args)
      );
    });
    if (matching.length !== 1) return { kind: "not_migrating" } as const;
    const connection = matching[0];
    if (!connection) return { kind: "not_migrating" } as const;
    return {
      kind: "allow_connection",
      arrivalConnectionId: connection.id,
      keepAccounts: [
        { providerId: args.providerId, accountId: args.accountId },
      ],
    } as const;
  }

  private accountMatchesPair({
    account,
    legacy,
    replacement,
  }: {
    account: { providerId: string; accountId: string };
    legacy: { providerId: string };
    replacement: { id: string };
  }): boolean {
    return (
      account.providerId === replacement.id ||
      isSsoProviderMatch({ ssoProvider: legacy.providerId }, account)
    );
  }

  private callbackMatchesPair({
    callback,
    accounts,
    pair,
  }: {
    callback: { kind: "direct" | "legacy"; providerId: string };
    accounts: readonly { provider: string; providerAccountId: string }[];
    pair: {
      replacement: { id: string };
      legacy: { providerId: string };
    };
  }): boolean {
    if (callback.kind === "direct") {
      return callback.providerId === pair.replacement.id;
    }
    return accounts.some((account) =>
      legacyCallbackMatches({
        callbackProviderId: callback.providerId,
        legacyProviderId: pair.legacy.providerId,
        account,
      }),
    );
  }
}

const toHookAccount = (account: {
  provider: string;
  providerAccountId: string;
}): { providerId: string; accountId: string } => ({
  providerId: account.provider,
  accountId: account.providerAccountId,
});

export const ssoCallbackProviderFromPath = (
  path: string | undefined,
): { kind: "direct" | "legacy"; providerId: string } | null => {
  if (!path) return null;
  for (const marker of DIRECT_CALLBACK_MARKERS) {
    const offset = path.indexOf(marker);
    if (offset >= 0) {
      const providerId = path.slice(offset + marker.length).split(/[/?#]/)[0];
      return providerId ? { kind: "direct", providerId } : null;
    }
  }
  const match = path.match(/\/callback\/([^/?#]+)/);
  return match?.[1] ? { kind: "legacy", providerId: match[1] } : null;
};

export const legacyCallbackMatches = ({
  callbackProviderId,
  legacyProviderId,
  account,
}: {
  callbackProviderId: string;
  legacyProviderId: string;
  account: { provider: string; providerAccountId: string };
}): boolean =>
  account.provider === callbackProviderId &&
  isSsoProviderMatch(
    { ssoProvider: legacyProviderId },
    { providerId: account.provider, accountId: account.providerAccountId },
  );

export const legacyAuthenticationIsRetired = (phase: string | null): boolean =>
  phase === "FINALIZING" || phase === "FINALIZED";

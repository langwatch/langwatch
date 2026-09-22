// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { extractEmailDomain, isSsoProviderMatch } from "@ee/sso/matching";
import {
  normalizeDomain,
  qualifySsoDomainOwnership,
  ssoDomainVerificationSchema,
  ssoIdpMetadataSchema,
} from "@langwatch/identity";
import type { Prisma, PrismaClient } from "~/generated/prisma/client";
import type { DatabaseHookSsoMigrationPort } from "~/server/better-auth/hooks";
import { arrivalMatchOf, replacementProvesDomain } from "./sso-migration.rules";
import { countAccountsHoldingAddresses } from "./sso-migration-user-lookups.prisma";
import type { SsoMigrationMemberMove } from "./sso-self-serve.types";

const DIRECT_CALLBACK_MARKERS = ["/sso/callback/", "/sso/saml2/sp/acs/"];

interface AuthenticationPair {
  replacement: {
    id: string;
    organizationId: string;
    migrationPhase: string | null;
  };
  legacy: { id: string; organizationId: string; providerId: string };
}

type MigrationAuthenticationDecision =
  | { action: "continue" }
  | {
      action: "reject";
      code:
        | "SSO_LEGACY_AUTH_RETIRED"
        | "SSO_MIGRATION_AUTH_AMBIGUOUS"
        | "SSO_MIGRATION_AUTH_NOT_ALLOWED";
    }
  | {
      action: "record";
      connection: { id: string; organizationId: string };
    };

type AuthenticationMatch = {
  connection: { id: string; organizationId: string };
  replacementPhase: string | null;
  legacy: boolean;
};

/**
 * What one legacy/replacement pair makes of this callback.
 *
 * `namedWithoutBinding` is the case a bare absence cannot express: the
 * callback names this pair's replacement, but the account presented is not
 * bound to it. That is a refusal, not a miss — treating it as a miss would let
 * an unrelated account through a provider it was never linked to.
 */
function matchAuthenticationPair({
  callback,
  account,
  pair,
}: {
  callback: { kind: "direct" | "legacy"; providerId: string };
  account: { provider: string; providerAccountId: string };
  pair: AuthenticationPair;
}): { match: AuthenticationMatch | null; namedWithoutBinding: boolean } {
  if (callback.kind === "direct") {
    if (callback.providerId !== pair.replacement.id) {
      return { match: null, namedWithoutBinding: false };
    }
    if (account.provider !== pair.replacement.id) {
      return { match: null, namedWithoutBinding: true };
    }
    return {
      match: {
        connection: {
          id: pair.replacement.id,
          organizationId: pair.replacement.organizationId,
        },
        replacementPhase: pair.replacement.migrationPhase,
        legacy: false,
      },
      namedWithoutBinding: false,
    };
  }

  const legacyAccount = legacyCallbackMatches({
    callbackProviderId: callback.providerId,
    legacyProviderId: pair.legacy.providerId,
    account,
  });
  if (!legacyAccount) return { match: null, namedWithoutBinding: false };
  return {
    match: {
      connection: {
        id: pair.legacy.id,
        organizationId: pair.legacy.organizationId,
      },
      replacementPhase: pair.replacement.migrationPhase,
      legacy: true,
    },
    namedWithoutBinding: false,
  };
}

/**
 * What the pairs, taken together, say about this callback.
 *
 * More than one match is ambiguous: two pairs claiming the same callback and
 * account cannot be ordered, and recording either would attribute the sign-in
 * to an organization we are guessing at.
 */
function decideFromMatches({
  matches,
  directMigrationNamedWithoutBinding,
}: {
  matches: readonly AuthenticationMatch[];
  directMigrationNamedWithoutBinding: boolean;
}): MigrationAuthenticationDecision {
  if (matches.length > 1) {
    return { action: "reject", code: "SSO_MIGRATION_AUTH_AMBIGUOUS" };
  }
  const match = matches[0];
  if (!match) {
    return directMigrationNamedWithoutBinding
      ? { action: "reject", code: "SSO_MIGRATION_AUTH_NOT_ALLOWED" }
      : { action: "continue" };
  }
  if (match.legacy && legacyAuthenticationIsRetired(match.replacementPhase)) {
    return { action: "reject", code: "SSO_LEGACY_AUTH_RETIRED" };
  }
  return { action: "record", connection: match.connection };
}

export function migrationAuthenticationDecision({
  callback,
  account,
  pairs,
}: {
  callback: { kind: "direct" | "legacy"; providerId: string };
  account: { provider: string; providerAccountId: string };
  pairs: readonly AuthenticationPair[];
}): MigrationAuthenticationDecision {
  const outcomes = pairs.map((pair) =>
    matchAuthenticationPair({ callback, account, pair }),
  );
  return decideFromMatches({
    matches: outcomes
      .map((outcome) => outcome.match)
      .filter((match): match is AuthenticationMatch => match !== null),
    directMigrationNamedWithoutBinding: outcomes.some(
      (outcome) => outcome.namedWithoutBinding,
    ),
  });
}

/** What the link policy refuses with when the replacement cannot match a person. */
const LINK_REFUSALS = {
  "no-address": "SSO_MIGRATION_LINK_UNVERIFIED",
  "shared-address": "SSO_MIGRATION_LINK_AMBIGUOUS",
  "unproved-domain": "SSO_MIGRATION_LINK_NOT_ALLOWED",
} as const satisfies Record<Exclude<SsoMigrationMemberMove, "matched">, string>;

const NOT_MIGRATING = {
  kind: "not_migrating",
  decision: { kind: "not_migrating" } as const,
} as const;

/** Better Auth's migration callback policy, backed only by persisted facts. */
export class PrismaSsoMigrationCallbackPolicy
  implements DatabaseHookSsoMigrationPort
{
  constructor(
    private readonly prisma: PrismaClient,
    private readonly newActivityId: () => string,
    private readonly assertions: {
      authenticatedAccountFor(args: { providerId: string }): Promise<{
        providerAccountId: string;
      } | null>;
    },
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

    const resolved = this.resolveLinkPair({ context, args });
    if (resolved.kind === "reject") return resolved;
    const { pair, direct } = resolved;

    const keep = await this.keepAccountsFor({ args, pair });
    if (keep.kind === "reject") return keep;

    return {
      kind: "allow_replacement_pair",
      arrivalConnectionId: direct ? pair.replacement.id : pair.legacy.id,
      keepAccounts: keep.accounts,
    } as const;
  }

  /**
   * The one pair this account may link through, or the refusal.
   *
   * Exactly one: an account matching several pairs is ambiguous rather than a
   * free choice, because picking one of them would silently decide which
   * organization the user joins.
   */
  private resolveLinkPair({
    context,
    args,
  }: {
    context: { pairs: readonly AuthenticationPair[] };
    args: { providerId: string; accountId: string };
  }) {
    const matching = context.pairs.filter(({ legacy, replacement }) =>
      this.accountMatchesPair({ account: args, legacy, replacement }),
    );
    if (matching.length > 1) {
      return { kind: "reject", code: "SSO_MIGRATION_LINK_AMBIGUOUS" } as const;
    }
    const pair = matching[0];
    if (!pair) {
      return {
        kind: "reject",
        code: "SSO_MIGRATION_LINK_NOT_ALLOWED",
      } as const;
    }
    const direct = args.providerId === pair.replacement.id;
    if (
      !direct &&
      legacyAuthenticationIsRetired(pair.replacement.migrationPhase)
    ) {
      return { kind: "reject", code: "SSO_LEGACY_AUTH_RETIRED" } as const;
    }
    return { kind: "pair", pair, direct } as const;
  }

  /**
   * The at-most-two accounts the pair may keep: the one arriving, and the one
   * already linked on the other side of the cutover.
   *
   * De-duplicated on the exact (provider, account) tuple, so re-presenting the
   * same account is not counted twice. More than two distinct accounts means
   * the user holds identities on this pair we cannot order, which is ambiguous
   * rather than a reason to pick one.
   */
  private async keepAccountsFor({
    args,
    pair,
  }: {
    args: { userId: string; providerId: string; accountId: string };
    pair: AuthenticationPair;
  }) {
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
    return {
      kind: "accounts",
      accounts: [first, keepAccounts[1] ?? first],
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
  }): Promise<
    | { action: "continue" }
    | {
        action: "reject";
        code:
          | "SSO_LEGACY_AUTH_RETIRED"
          | "SSO_MIGRATION_AUTH_AMBIGUOUS"
          | "SSO_MIGRATION_AUTH_NOT_ALLOWED";
      }
  > {
    const callback = ssoCallbackProviderFromPath(path);
    if (!callback) return { action: "continue" } as const;

    return await this.prisma.$transaction(
      async (tx) => {
        const context = await this.contextForUser(tx, userId);
        if (context.kind === "not_migrating") {
          return { action: "continue" } as const;
        }

        const accepted = await this.assertions.authenticatedAccountFor({
          providerId: callback.providerId,
        });
        if (!accepted) {
          return {
            action: "reject",
            code: "SSO_MIGRATION_AUTH_NOT_ALLOWED",
          } as const;
        }
        const pairs =
          "authenticationPairs" in context && context.authenticationPairs
            ? context.authenticationPairs
            : context.pairs;
        const decision = migrationAuthenticationDecision({
          callback,
          account: {
            provider: callback.providerId,
            providerAccountId: accepted.providerAccountId,
          },
          pairs,
        });
        if (decision.action !== "record") return decision;

        await tx.ssoAuthenticationActivity.create({
          data: {
            id: this.newActivityId(),
            organizationId: decision.connection.organizationId,
            connectionId: decision.connection.id,
            userId,
            authenticatedAt,
          },
        });
        return { action: "continue" } as const;
      },
      { isolationLevel: "Serializable" },
    );
  }

  /**
   * The legacy/replacement pairs this user's organizations are migrating on.
   *
   * A replacement whose predecessor is missing, is not the grandfathered
   * legacy connection, or whose metadata does not parse yields NO pair rather
   * than a half-populated one: the callers below decide authentication from a
   * pair, so an incomplete pair would be a decision made on absent evidence.
   */
  private async loadPairs({
    reads,
    organizationIds,
  }: {
    reads: PrismaClient | Prisma.TransactionClient;
    organizationIds: string[];
  }) {
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
    const predecessors = await reads.ssoConnection.findMany({
      where: {
        id: {
          in: replacements.flatMap(({ replacesConnectionId }) =>
            replacesConnectionId ? [replacesConnectionId] : [],
          ),
        },
        source: "legacy-grandfathered",
      },
      select: { id: true, organizationId: true, idpMetadata: true },
    });
    return replacements.flatMap((replacement) => {
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
  }

  private async contextForUser(
    reads: PrismaClient | Prisma.TransactionClient,
    userId: string,
  ) {
    const user = await reads.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        orgMemberships: { select: { organizationId: true } },
      },
    });
    if (!user) return NOT_MIGRATING;
    const pairs = await this.loadPairs({
      reads,
      organizationIds: user.orgMemberships.map(
        ({ organizationId }) => organizationId,
      ),
    });
    if (pairs.length === 0) return NOT_MIGRATING;
    const qualifiedPairs = (domain: string) =>
      pairs.filter(({ replacement }) =>
        replacementProvesDomain({ replacement, domain }),
      );
    const match = arrivalMatchOf({
      email: user.email,
      accountsHoldingAddress: user.email
        ? ((
            await countAccountsHoldingAddresses({
              prisma: reads,
              addresses: [user.email],
            })
          ).get(user.email.toLowerCase()) ?? 0)
        : 0,
      provesDomain: (domain) => qualifiedPairs(domain).length > 0,
    });
    if (match !== "matched") {
      return {
        kind: match,
        pairs,
        decision: { kind: "reject", code: LINK_REFUSALS[match] } as const,
      } as const;
    }
    return {
      kind: "ready",
      pairs: qualifiedPairs(
        normalizeDomain(extractEmailDomain(user.email) ?? ""),
      ),
      authenticationPairs: pairs,
    } as const;
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
            connectionId: connection.id,
            organizationId: ownership.organizationId,
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

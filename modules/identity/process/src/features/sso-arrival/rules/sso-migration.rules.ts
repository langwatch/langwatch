import { extractEmailDomain, isSsoProviderMatch } from "@langwatch/auth-contract";
import {
  normalizeDomain,
  qualifySsoDomainOwnership,
  type SsoConnectionState,
  type SsoMigrationMemberMove,
  type SsoMigrationBlockerView,
  type SsoMigrationConnectionRef,
  type SsoMigrationScimStatus,
  type SsoMigrationView,
} from "@langwatch/identity-contract";

const DAY_MS = 24 * 60 * 60 * 1000;
/** How long after the last sign-in through the previous provider finishing waits. */
export const MIGRATION_QUIET_PERIOD_MS = 7 * DAY_MS;
/** How long after the switch-over finishing waits when nobody uses the previous provider. */
export const MIGRATION_QUIET_FLOOR_MS = 2 * DAY_MS;

/**
 * When finishing opens: two days after the switch-over, or seven after the
 * last legacy sign-in since then, whichever is later. Sign-ins before the
 * switch-over are old-route by design and do not count.
 */
export function quietPeriodOf({
  switchedOverAtMs,
  lastLegacyAuthenticationAtMs,
  nowMs,
}: {
  switchedOverAtMs: number | null;
  lastLegacyAuthenticationAtMs: number | null;
  nowMs: number;
}): { clearsAtMs: number | null; complete: boolean } {
  if (switchedOverAtMs === null) return { clearsAtMs: null, complete: false };
  const straggler =
    lastLegacyAuthenticationAtMs !== null && lastLegacyAuthenticationAtMs > switchedOverAtMs
      ? lastLegacyAuthenticationAtMs + MIGRATION_QUIET_PERIOD_MS
      : 0;
  const clearsAtMs = Math.max(switchedOverAtMs + MIGRATION_QUIET_FLOOR_MS, straggler);

  return { clearsAtMs, complete: nowMs >= clearsAtMs };
}

/**
 * How the replacement matches an arriving person to their account: by address,
 * on a domain it has proved. The link policy decides a real arrival with it and
 * the update's progress lists who will not be recognised.
 */
export function arrivalMatchOf({
  email,
  accountsHoldingAddress,
  provesDomain,
}: {
  email: string | null;
  /** Accounts holding this address, compared without case. */
  accountsHoldingAddress: number;
  provesDomain: (domain: string) => boolean;
}): SsoMigrationMemberMove {
  const rawDomain = email ? extractEmailDomain(email) : null;
  if (!rawDomain) return "no-address";
  if (accountsHoldingAddress !== 1) return "shared-address";

  return provesDomain(normalizeDomain(rawDomain)) ? "matched" : "unproved-domain";
}

/** How the replacement will recognise each member who has not signed in through it yet. */
export function memberMovesOf({
  members,
  holders,
  replacement,
}: {
  members: readonly { userId: string; email: string | null }[];
  /** Accounts holding each address, keyed lowercased. */
  holders: ReadonlyMap<string, number>;
  replacement: SsoConnectionState;
}): Map<string, SsoMigrationMemberMove> {
  return new Map(
    members.map(({ userId, email }) => [
      userId,
      arrivalMatchOf({
        email,
        accountsHoldingAddress: email ? (holders.get(email.toLowerCase()) ?? 0) : 0,
        provesDomain: (domain) =>
          qualifySsoDomainOwnership({ state: replacement, domain }).status === "QUALIFIED",
      }),
    ]),
  );
}

/**
 * The people whose only verified way in is an identity on the previous provider.
 * Finishing leaves it in place and the replacement matches them by address at
 * their next sign-in. A passkey carries no address, so it is not another way in.
 */
export function strandedUserIdsOf({
  identifiers,
  legacyIdentifierIds,
}: {
  identifiers: readonly { id: string; userId: string; state: string; provider: string }[];
  legacyIdentifierIds: ReadonlySet<string>;
}): Set<string> {
  const verified = identifiers.filter(({ state }) => state === "VERIFIED" || state === "PRIMARY");
  const otherWayIn = new Set(
    verified
      .filter(({ id, provider }) => !legacyIdentifierIds.has(id) && provider !== "passkey")
      .map(({ userId }) => userId),
  );

  return new Set(
    verified
      .filter(({ id }) => legacyIdentifierIds.has(id))
      .map(({ userId }) => userId)
      .filter((userId) => !otherWayIn.has(userId)),
  );
}

/** One live identifier, as finishing the update weighs it. */
type MigrationHoldingView = MigrationIdentifierBinding & {
  identifierId: string;
  userId: string;
  state: string;
  provider: string;
};

type MigrationConnectionView = {
  connectionId: string;
  source: string;
  idpMetadata: { providerId: string };
};

/** Which identifiers belong to the previous provider, and who has no other way in. */
export function legacyStandingOf({
  holdings,
  legacy,
}: {
  holdings: readonly MigrationHoldingView[];
  legacy: MigrationConnectionView;
}): { legacyIdentifierIds: Set<string>; strandedUserIds: Set<string> } {
  const legacyIdentifierIds = new Set(
    holdings
      .filter((identifier) =>
        identifierBelongsToMigrationConnection({ identifier, connection: legacy }),
      )
      .map(({ identifierId }) => identifierId),
  );
  const strandedUserIds = strandedUserIdsOf({
    identifiers: holdings.map(({ identifierId, userId, state, provider }) => ({
      id: identifierId,
      userId,
      state,
      provider,
    })),
    legacyIdentifierIds,
  });

  return { legacyIdentifierIds, strandedUserIds };
}

/**
 * Who takes over as primary when one person's legacy primary goes, best first:
 * the replacement's own, then their address, then any other proved way in.
 * A passkey never takes over.
 */
export function successorsOf<Holding extends MigrationHoldingView>({
  holdings,
  legacyIdentifierIds,
  replacement,
}: {
  holdings: readonly Holding[];
  legacyIdentifierIds: ReadonlySet<string>;
  replacement: MigrationConnectionView;
}): Holding[] {
  const rank = (holding: Holding): number => {
    if (identifierBelongsToMigrationConnection({ identifier: holding, connection: replacement })) {
      return 0;
    }
    return holding.provider === "email" ? 1 : 2;
  };

  return holdings
    .filter(
      ({ identifierId, state, provider }) =>
        (state === "VERIFIED" || state === "PRIMARY") &&
        !legacyIdentifierIds.has(identifierId) &&
        provider !== "passkey",
    )
    .toSorted(
      (left, right) =>
        rank(left) - rank(right) || left.identifierId.localeCompare(right.identifierId),
    );
}

/** One identifier, as the pair asks about it. */
export interface MigrationIdentifierBinding {
  connectionId: string | null;
  providerId: string | null;
  providerAccountId: string | null;
}

/**
 * Older identity facts carry the native provider binding without a
 * connection id. An explicit connection association always wins over that
 * legacy representation.
 */
export function identifierBelongsToMigrationConnection({
  identifier,
  connection,
}: {
  identifier: MigrationIdentifierBinding;
  connection: { connectionId: string; source: string; idpMetadata: { providerId: string } };
}): boolean {
  if (identifier.connectionId !== null) {
    return identifier.connectionId === connection.connectionId;
  }
  if (!identifier.providerId || !identifier.providerAccountId) return false;
  if (connection.source !== "legacy-grandfathered") {
    return identifier.providerId === connection.connectionId;
  }
  if (identifier.providerId === "credential") return false;
  // Only the Auth0 broker interprets the subject as an upstream connection
  // prefix. A direct provider may return the same subject without belonging
  // to that broker.
  if (
    identifier.providerId !== "auth0" &&
    identifier.providerId !== connection.idpMetadata.providerId
  ) {
    return false;
  }

  // The same comparison the sign-in path makes, asked of the connection's own
  // provider: identity's pair question and auth's enforcement are one rule.
  return isSsoProviderMatch(
    { ssoProvider: connection.idpMetadata.providerId },
    { providerId: identifier.providerId, accountId: identifier.providerAccountId },
  );
}

/** Whether directory provisioning is on the replacement yet. Finishing waits for
 *  it until the connection pipeline that moves it is hosted (merge-m3 ruling). */
export function scimStatusOf({
  legacySyncs,
  replacementSyncState,
}: {
  legacySyncs: boolean;
  replacementSyncState: string | null | undefined;
}): SsoMigrationScimStatus {
  if (replacementSyncState === "SYNCING" || replacementSyncState === "TOKEN_ISSUED") {
    return "ready";
  }
  if (!legacySyncs) return "not-applicable";

  return "needs-repointing";
}

export function migrationBlockers({
  selectedRoute,
  testSignInDone,
  liveRecoveryCount,
  quietComplete,
  scimStatus,
  sharedLegacyIdentifiers,
}: {
  selectedRoute: SsoMigrationView["selectedRoute"];
  testSignInDone: boolean;
  liveRecoveryCount: number;
  quietComplete: boolean;
  scimStatus: SsoMigrationScimStatus;
  sharedLegacyIdentifiers: boolean;
}): SsoMigrationBlockerView[] {
  const blockers: SsoMigrationBlockerView[] = [];
  if (selectedRoute !== "direct") {
    blockers.push({
      code: "direct-route-not-selected",
      message: "Switch normal sign-in to the replacement connection first.",
    });
  }
  if (!testSignInDone) {
    blockers.push({
      code: "replacement-not-tested",
      message: "Complete a successful test sign-in through the replacement.",
    });
  }
  if (liveRecoveryCount === 0) {
    blockers.push({
      code: "recovery-path-missing",
      message:
        "Keep at least one live way back in before finalizing. Grant it to somebody who has set a password — after the switch the old provider will not be there to sign them in, and a password can only be set while somebody is still signed in.",
    });
  }
  if (!quietComplete) {
    blockers.push({
      code: "legacy-activity-not-quiet",
      message:
        "Wait two days after the switch-over, and seven after the last legacy sign-in since then.",
    });
  }
  if (scimStatus === "needs-repointing") {
    blockers.push({
      code: "scim-needs-repointing",
      message: "Repoint directory provisioning to the replacement connection.",
    });
  }
  if (sharedLegacyIdentifiers) {
    blockers.push({
      code: "shared-legacy-identifiers",
      message: "A legacy identity is shared with another organization and needs review.",
    });
  }

  return blockers;
}

export function connectionRefOf(connection: SsoConnectionState): SsoMigrationConnectionRef {
  return {
    connectionId: connection.connectionId,
    source: connection.source,
    providerId: connection.idpMetadata.providerId,
  };
}

/** The straggler page, and whether another one follows it. */
export function membersViewOf({
  evidence,
  limit,
}: {
  evidence: {
    activeCount: number;
    linkedCount: number;
    stragglerIds: string[];
    pageRows: { userId: string; name: string | null; email: string | null }[];
    legacyActivityByUser: ReadonlyMap<string, number>;
    /** Every member not yet on the replacement, and how it will recognise them. */
    moves: ReadonlyMap<string, SsoMigrationMemberMove>;
  };
  limit: number;
}): SsoMigrationView["members"] {
  const { activeCount, linkedCount, stragglerIds, pageRows, moves } = evidence;

  return {
    activeCount,
    linkedCount,
    nextSignInCount: [...moves.values()].filter((move) => move === "matched").length,
    stragglers: pageRows.map((row) => ({
      userId: row.userId,
      name: row.name,
      email: row.email,
      lastLegacyAuthenticationAtMs: evidence.legacyActivityByUser.get(row.userId) ?? null,
      move: moves.get(row.userId) ?? "no-address",
    })),
    nextCursor: stragglerIds.length > limit ? (pageRows.at(-1)?.userId ?? null) : null,
  };
}

/** What the replacement carried over, still qualifying today (ADR-123). */
export function inheritedDomainsOf({
  replacement,
  legacy,
}: {
  replacement: SsoConnectionState;
  legacy: SsoConnectionState;
}): SsoMigrationView["inheritedDomains"] {
  return replacement.domainVerifications
    .filter(
      (proof) =>
        legacy.verifiedDomains.includes(proof.domain) &&
        qualifySsoDomainOwnership({ state: replacement, domain: proof.domain }).status ===
          "QUALIFIED",
    )
    .map((proof) => ({
      domain: proof.domain,
      method: proof.method,
      proofState: proof.proofState,
      evidenceRef: proof.tokenHash,
      verifiedAtMs: proof.verifiedAtMs,
    }));
}

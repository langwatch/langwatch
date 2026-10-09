// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { extractEmailDomain, isSsoProviderMatch } from "@ee/sso/matching";
import {
  normalizeDomain,
  qualifySsoDomainOwnership,
  type SsoConnectionState,
  ssoDomainVerificationSchema,
} from "@langwatch/identity";
import type { SsoMigrationFinalizationBlocker } from "./sso-migration-finalization.service";
import type {
  SelfServeMigrationView,
  SsoMigrationBlockerView,
  SsoMigrationMemberMove,
} from "./sso-self-serve.types";

export interface LegacyAccountEvidence {
  remaining: number;
  unassociated: number;
  ambiguous: boolean;
}

export interface MigrationIdentifierBinding {
  connectionId: string | null;
  providerId: string | null;
  providerAccountId: string | null;
}

/** Older identity facts carry the native provider binding without a connection id.
 * An explicit connection association always wins over that legacy representation. */
export function identifierBelongsToMigrationConnection({
  identifier,
  connection,
}: {
  identifier: MigrationIdentifierBinding;
  connection: {
    connectionId: string;
    source: string;
    idpMetadata: { providerId: string };
  };
}): boolean {
  if (identifier.connectionId !== null) {
    return identifier.connectionId === connection.connectionId;
  }
  if (!identifier.providerId || !identifier.providerAccountId) return false;
  if (connection.source !== "legacy-grandfathered") {
    return identifier.providerId === connection.connectionId;
  }
  if (identifier.providerId === "credential") return false;
  // Only the Auth0 broker interprets the subject as an upstream connection prefix.
  // A direct provider may return the same subject without belonging to that broker.
  if (
    identifier.providerId !== "auth0" &&
    identifier.providerId !== connection.idpMetadata.providerId
  )
    return false;
  return isSsoProviderMatch(
    { ssoProvider: connection.idpMetadata.providerId },
    {
      providerId: identifier.providerId,
      accountId: identifier.providerAccountId,
    },
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** How long after the last sign-in through the previous provider finishing waits. */
export const MIGRATION_QUIET_PERIOD_MS = 7 * DAY_MS;
/** How long after the switch-over finishing waits when nobody uses the previous provider. */
export const MIGRATION_QUIET_FLOOR_MS = 2 * DAY_MS;

/**
 * When finishing opens: two days after the switch-over, or seven days after
 * the last sign-in through the previous provider since then, whichever is
 * later.
 *
 * The wait exists to catch people still signing in the old way, so it only
 * counts sign-ins the switch-over did not already account for. Before the
 * switch-over everybody signs in the old way by design, and counting those
 * made every update wait a week however quiet the old route went.
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
    lastLegacyAuthenticationAtMs !== null &&
    lastLegacyAuthenticationAtMs > switchedOverAtMs
      ? lastLegacyAuthenticationAtMs + MIGRATION_QUIET_PERIOD_MS
      : 0;
  const clearsAtMs = Math.max(
    switchedOverAtMs + MIGRATION_QUIET_FLOOR_MS,
    straggler,
  );
  return { clearsAtMs, complete: nowMs >= clearsAtMs };
}

/**
 * How the replacement matches a person arriving through it to their existing
 * account: by address, on a domain it has proved.
 *
 * One answer for two callers: the link policy decides a real arrival with it,
 * and the update's progress lists who will not be recognised. The replacement
 * is the authority for addresses on a domain it proved, so an address nobody
 * confirmed is matched there too; it cannot be trusted for any other domain,
 * and an address two accounts hold names neither.
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
  return provesDomain(normalizeDomain(rawDomain))
    ? "matched"
    : "unproved-domain";
}

/**
 * Whether the replacement's own evidence proves this email domain, read from
 * the stored row the way a real arrival reads it.
 *
 * Verification rows that do not parse are dropped rather than trusted: a proof
 * we cannot read is not a proof, and reading it as one would qualify a domain
 * on the strength of a malformed row.
 */
export function replacementProvesDomain({
  replacement,
  domain,
}: {
  replacement: {
    id: string;
    organizationId: string;
    replacesConnectionId: string | null;
    verifiedDomains: string[];
    domainVerifications: unknown;
  };
  domain: string;
}): boolean {
  const parsed = ssoDomainVerificationSchema
    .array()
    .safeParse(replacement.domainVerifications);
  return (
    qualifySsoDomainOwnership({
      state: {
        connectionId: replacement.id,
        organizationId: replacement.organizationId,
        replacesConnectionId: replacement.replacesConnectionId,
        verifiedDomains: replacement.verifiedDomains,
        domainVerifications: parsed.success ? parsed.data : [],
      },
      domain,
    }).status === "QUALIFIED"
  );
}

/**
 * The people whose only verified way in is an identity on the previous
 * provider.
 *
 * Finishing leaves their previous identity in place, since the identity
 * guards refuse to take anybody's last way in; it stops working when the
 * previous connection is torn down, and the replacement matches them by
 * address at their next sign-in. A passkey is not another way in: it has no
 * address behind it.
 */
export function strandedUserIdsOf({
  identifiers,
  legacyIdentifierIds,
}: {
  identifiers: readonly {
    id: string;
    userId: string;
    state: string;
    provider: string;
  }[];
  legacyIdentifierIds: ReadonlySet<string>;
}): Set<string> {
  const verified = identifiers.filter(
    ({ state }) => state === "VERIFIED" || state === "PRIMARY",
  );
  const otherWayIn = new Set(
    verified
      .filter(
        ({ id, provider }) =>
          !legacyIdentifierIds.has(id) && provider !== "passkey",
      )
      .map(({ userId }) => userId),
  );
  return new Set(
    verified
      .filter(({ id }) => legacyIdentifierIds.has(id))
      .map(({ userId }) => userId)
      .filter((userId) => !otherWayIn.has(userId)),
  );
}

type ConnectionState = SsoConnectionState;

export function routeOf(
  migrationPhase: ConnectionState["migrationPhase"],
): SelfServeMigrationView["selectedRoute"] {
  return migrationPhase === "SETUP" || migrationPhase === "GRACE_LEGACY"
    ? "legacy"
    : "direct";
}

export function scimStatusOf({
  legacySyncs,
  replacementSyncState,
}: {
  legacySyncs: boolean;
  replacementSyncState: string | null | undefined;
}): SelfServeMigrationView["scim"]["status"] {
  if (
    replacementSyncState === "SYNCING" ||
    replacementSyncState === "TOKEN_ISSUED"
  ) {
    return "ready";
  }
  if (!legacySyncs) return "not-applicable";
  // The previous connection's sync moves to the replacement when the update
  // finishes; nothing is asked of the customer for it.
  return "moves-with-finish";
}

export function migrationBlockers({
  selectedRoute,
  testSignInDone,
  liveRecoveryCount,
  quietComplete,
  sharedLegacyIdentifiers,
}: {
  selectedRoute: SelfServeMigrationView["selectedRoute"];
  testSignInDone: boolean;
  liveRecoveryCount: number;
  quietComplete: boolean;
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
  if (sharedLegacyIdentifiers) {
    blockers.push({
      code: "shared-legacy-identifiers",
      message:
        "A legacy identity is shared with another organization and needs review.",
    });
  }
  return blockers;
}

export function connectionRefOf(
  connection: ConnectionState,
): SelfServeMigrationView["legacy"] {
  return {
    connectionId: connection.connectionId,
    source: connection.source,
    providerId: connection.idpMetadata.providerId,
  };
}

export function membersViewOf({
  evidence,
  limit,
}: {
  evidence: {
    activeCount: number;
    linkedCount: number;
    nextSignInCount: number;
    moves: Map<string, SsoMigrationMemberMove>;
    stragglerRows: { userId: string }[];
    pageRows: {
      userId: string;
      name: string | null;
      email: string | null;
    }[];
    legacyActivityByUser: Map<string, Date>;
  };
  limit: number;
}): SelfServeMigrationView["members"] {
  const { stragglerRows, pageRows } = evidence;
  return {
    activeCount: evidence.activeCount,
    linkedCount: evidence.linkedCount,
    nextSignInCount: evidence.nextSignInCount,
    stragglers: pageRows.map((row) => ({
      userId: row.userId,
      name: row.name,
      email: row.email,
      lastLegacyAuthenticationAtMs:
        evidence.legacyActivityByUser.get(row.userId)?.getTime() ?? null,
      move: evidence.moves.get(row.userId) ?? "no-address",
    })),
    nextCursor:
      stragglerRows.length > limit ? (pageRows.at(-1)?.userId ?? null) : null,
  };
}

export function inheritedDomainsOf({
  replacement,
  legacy,
}: {
  replacement: ConnectionState;
  legacy: ConnectionState;
}): SelfServeMigrationView["inheritedDomains"] {
  return replacement.domainVerifications
    .filter(
      (proof) =>
        legacy.verifiedDomains.includes(proof.domain) &&
        qualifySsoDomainOwnership({ state: replacement, domain: proof.domain })
          .status === "QUALIFIED",
    )
    .map((proof) => ({
      domain: proof.domain,
      method: proof.method,
      proofState: proof.proofState,
      evidenceRef: proof.evidenceRef ?? proof.tokenHash,
      verifiedAtMs: proof.verifiedAtMs,
    }));
}

export function finalizationBlockers(
  current: readonly SsoMigrationFinalizationBlocker[],
  evidence: {
    replacementActive: boolean;
    qualifiedProofs: number;
    recovery: boolean;
    legacyAccounts: LegacyAccountEvidence;
  },
): SsoMigrationFinalizationBlocker[] {
  const blockers = [...current];
  if (!evidence.replacementActive) {
    addBlocker(blockers, {
      code: "replacement-not-active",
      message: "Activate the replacement connection before finalizing.",
    });
  }
  if (evidence.qualifiedProofs === 0) {
    addBlocker(blockers, {
      code: "domain-ownership-proof-missing",
      message:
        "The replacement no longer holds a current organization-owned domain proof.",
    });
  }
  if (!evidence.recovery) {
    addBlocker(blockers, {
      code: "recovery-path-missing",
      message:
        "A live break-glass binding and a configured local sign-in method are required.",
    });
  }
  if (evidence.legacyAccounts.ambiguous) {
    addBlocker(blockers, {
      code: "legacy-provider-ambiguous",
      message:
        "A legacy account is also in scope for another organization's provider.",
    });
  }
  if (evidence.legacyAccounts.unassociated > 0) {
    addBlocker(blockers, {
      code: "legacy-account-association-ambiguous",
      message:
        "A legacy account has no connection-scoped identifier and needs review.",
    });
  }
  return blockers;
}

function addBlocker(
  blockers: SsoMigrationFinalizationBlocker[],
  blocker: SsoMigrationFinalizationBlocker,
): void {
  if (!blockers.some(({ code }) => code === blocker.code)) {
    blockers.push(blocker);
  }
}

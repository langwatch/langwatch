// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { isSsoProviderMatch } from "@ee/sso/matching";
import {
  qualifySsoDomainOwnership,
  type SsoConnectionState,
} from "@langwatch/identity";
import type { SsoArrivalMatch } from "./sso-migration-arrival";
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
 * What moving one member across still needs, from whether the replacement
 * can match them and whether the previous provider is their only way in.
 *
 * A person the replacement can match still has to sign in once when the
 * previous provider is the only verified way in they hold: finishing takes
 * that away, and nobody may be left with no way in at all.
 */
export function memberMoveOf({
  arrival,
  previousIsOnlyWayIn,
}: {
  arrival: SsoArrivalMatch;
  previousIsOnlyWayIn: boolean;
}): SsoMigrationMemberMove {
  if (arrival !== "matched") return arrival;
  return previousIsOnlyWayIn ? "sign-in-once" : "next-sign-in";
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

const members = (count: number, kind: string) =>
  `${count} ${kind} member${count === 1 ? "" : "s"}`;

export function migrationBlockers({
  selectedRoute,
  testSignInDone,
  liveRecoveryCount,
  waitingCount,
  deactivatedOnPreviousCount,
  quietComplete,
  sharedLegacyIdentifiers,
}: {
  selectedRoute: SelfServeMigrationView["selectedRoute"];
  testSignInDone: boolean;
  liveRecoveryCount: number;
  waitingCount: number;
  deactivatedOnPreviousCount: number;
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
  if (waitingCount > 0) {
    blockers.push({
      code: "members-cannot-move-across",
      message: `${members(waitingCount, "active")} cannot be moved across by address yet.`,
    });
  }
  if (deactivatedOnPreviousCount > 0) {
    blockers.push({
      code: "deactivated-members-on-previous-provider",
      message: `${members(deactivatedOnPreviousCount, "deactivated")} can only sign in through the legacy connection.`,
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
    waitingCount: number;
    deactivatedOnPreviousCount: number;
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
    waitingCount: evidence.waitingCount,
    deactivatedOnPreviousCount: evidence.deactivatedOnPreviousCount,
    stragglers: pageRows.map((row) => ({
      userId: row.userId,
      name: row.name,
      email: row.email,
      lastLegacyAuthenticationAtMs:
        evidence.legacyActivityByUser.get(row.userId)?.getTime() ?? null,
      move: evidence.moves.get(row.userId) ?? "unverified-address",
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

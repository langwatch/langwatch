// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { isSsoProviderMatch } from "@ee/sso/matching";
import {
  qualifySsoDomainOwnership,
  type SsoConnectionState,
} from "@langwatch/identity";
import type { SsoMigrationFinalizationBlocker } from "./sso-migration-finalization.service";
import type {
  SelfServeMigrationView,
  SsoMigrationBlockerView,
} from "./sso-self-serve.types";

export interface LegacyAccountEvidence {
  remaining: number;
  unassociated: number;
  ambiguous: boolean;
  unverifiedDirectMembers: number;
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

export const MIGRATION_QUIET_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

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
  linkedCount,
  activeCount,
  quietComplete,
  scimStatus,
  sharedLegacyIdentifiers,
}: {
  selectedRoute: SelfServeMigrationView["selectedRoute"];
  testSignInDone: boolean;
  liveRecoveryCount: number;
  linkedCount: number;
  activeCount: number;
  quietComplete: boolean;
  scimStatus: SelfServeMigrationView["scim"]["status"];
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
  if (linkedCount < activeCount) {
    const unlinked = activeCount - linkedCount;
    blockers.push({
      code: "members-not-linked",
      message: `${unlinked} active member${unlinked === 1 ? " is" : "s are"} not linked to the replacement yet.`,
    });
  }
  if (!quietComplete) {
    blockers.push({
      code: "legacy-activity-not-quiet",
      message: "Wait for seven days without a successful legacy sign-in.",
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
  const { activeCount, linkedCount, stragglerRows, pageRows } = evidence;
  return {
    activeCount,
    linkedCount,
    stragglers: pageRows.map((row) => ({
      userId: row.userId,
      name: row.name,
      email: row.email,
      lastLegacyAuthenticationAtMs:
        evidence.legacyActivityByUser.get(row.userId)?.getTime() ?? null,
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
  if (evidence.legacyAccounts.unverifiedDirectMembers > 0) {
    addBlocker(blockers, {
      code: "members-not-verified-on-replacement",
      message:
        "Every current member must hold a verified replacement identifier before legacy access is removed.",
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

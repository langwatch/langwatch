import { isSsoProviderMatch } from "@langwatch/auth-contract";
import {
  qualifySsoDomainOwnership,
  type SsoConnectionState,
  type SsoMigrationBlockerView,
  type SsoMigrationConnectionRef,
  type SsoMigrationScimStatus,
  type SsoMigrationView,
} from "@langwatch/identity-contract";

/** Seven days without a successful legacy sign-in (ADR-117). */
export const MIGRATION_QUIET_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

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

/** Whether directory provisioning still has to be repointed. */
export function scimStatusOf({
  legacySyncs,
  replacementSyncState,
}: {
  legacySyncs: boolean;
  replacementSyncState: string | null | undefined;
}): SsoMigrationScimStatus {
  if (!legacySyncs) return "not-applicable";

  return replacementSyncState === "SYNCING" ? "ready" : "needs-repointing";
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
  selectedRoute: SsoMigrationView["selectedRoute"];
  testSignInDone: boolean;
  liveRecoveryCount: number;
  linkedCount: number;
  activeCount: number;
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
  };
  limit: number;
}): SsoMigrationView["members"] {
  const { activeCount, linkedCount, stragglerIds, pageRows } = evidence;

  return {
    activeCount,
    linkedCount,
    stragglers: pageRows.map((row) => ({
      userId: row.userId,
      name: row.name,
      email: row.email,
      lastLegacyAuthenticationAtMs: evidence.legacyActivityByUser.get(row.userId) ?? null,
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

import {
  LIVE_IDENTIFIER_STATES,
  qualifySsoDomainOwnership,
} from "@langwatch/identity";
import type {
  SelfServeMigrationView,
  SsoMigrationBlockerView,
  SsoMigrationProgressReadPort,
} from "@langwatch/identity-server";
import type { PrismaClient } from "~/generated/prisma/client";
import { rowToConnection } from "./sso-connection-projection.prisma.repository";

const MIGRATION_QUIET_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

type ConnectionState = ReturnType<typeof rowToConnection>;

/** Which connection normal sign-in currently goes through. */
function routeOf(
  migrationPhase: ConnectionState["migrationPhase"],
): SelfServeMigrationView["selectedRoute"] {
  return migrationPhase === "SETUP" || migrationPhase === "GRACE_LEGACY"
    ? "legacy"
    : "direct";
}

/**
 * Where directory provisioning points.
 *
 * A connection the legacy side never provisioned has nothing to repoint, which
 * is why the absence of a legacy sync is "not-applicable" rather than "ready":
 * the checklist must not credit an organization for a step it never had.
 */
function scimStatusOf({
  legacySyncs,
  replacementSyncState,
}: {
  legacySyncs: boolean;
  replacementSyncState: string | null | undefined;
}): SelfServeMigrationView["scim"]["status"] {
  if (!legacySyncs) return "not-applicable";
  return replacementSyncState === "SYNCING" ? "ready" : "needs-repointing";
}

/**
 * Everything standing between the organization and a finalized cutover.
 *
 * One list, in the order a customer reads it. A new condition on finalizing
 * belongs beside these rather than in whichever branch of `getProgress`
 * happens to compute the evidence for it.
 */
/** Exported so the blocker set — including the words a blocked administrator
 *  reads — is testable without standing the whole progress read up. */
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
  if (scimStatus === "needs-repointing") {
    blockers.push({
      code: "scim-needs-repointing",
      message: "Repoint directory provisioning to the replacement connection.",
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

/**
 * The three member filters the checklist counts over.
 *
 * All three share one definition of "a member who still counts" — in this
 * organization and not disabled — so it is written once and spread. `linked`
 * and `straggler` are exact complements over that set, which is what lets
 * `linkedCount` be compared against `activeCount` at all.
 */
function memberWhereClauses({
  organizationId,
  replacementConnectionId,
  liveStates,
  cursor,
}: {
  organizationId: string;
  replacementConnectionId: string;
  liveStates: string[];
  cursor: string | null;
}) {
  const memberWhere = { organizationId, disabledAt: null } as const;
  const onReplacement = {
    connectionId: replacementConnectionId,
    state: { in: liveStates },
  } as const;
  return {
    memberWhere,
    linkedWhere: {
      ...memberWhere,
      user: { identifiers: { some: onReplacement } },
    } as const,
    stragglerWhere: {
      ...memberWhere,
      ...(cursor ? { userId: { gt: cursor } } : {}),
      user: { identifiers: { none: onReplacement } },
    } as const,
  };
}

/** How a connection names itself on either side of the cutover. */
function connectionRefOf(
  connection: ConnectionState,
): SelfServeMigrationView["legacy"] {
  return {
    connectionId: connection.connectionId,
    source: connection.source,
    providerId: connection.idpMetadata.providerId,
  };
}

/**
 * The membership half of the checklist: how many are linked, and who is not.
 *
 * `stragglerRows` is deliberately one longer than the page. Having the extra
 * row is the only way to know whether a next page exists without a second
 * count, and it is dropped here rather than at the query so the paging rule
 * and the cursor it produces stay in one place.
 */
function membersViewOf({
  evidence,
  limit,
}: {
  evidence: {
    activeCount: number;
    linkedCount: number;
    stragglerRows: {
      userId: string;
      user: { name: string | null; email: string | null };
    }[];
    pageRows: {
      userId: string;
      user: { name: string | null; email: string | null };
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
      name: row.user.name,
      email: row.user.email,
      lastLegacyAuthenticationAtMs:
        evidence.legacyActivityByUser.get(row.userId)?.getTime() ?? null,
    })),
    nextCursor:
      stragglerRows.length > limit ? (pageRows.at(-1)?.userId ?? null) : null,
  };
}

/**
 * The domains the replacement carries over from the legacy connection.
 *
 * Membership of the legacy set is not on its own enough: the replacement's own
 * proof still has to qualify, so a domain whose evidence lapsed is not
 * inherited as though it had never been checked.
 */
function inheritedDomainsOf({
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

/** Operational evidence for the customer-visible Auth0 cutover checklist. */
export class PrismaSsoMigrationProgressRepository
  implements SsoMigrationProgressReadPort
{
  constructor(
    private readonly prisma: PrismaClient,
    private readonly now: () => number = Date.now,
    /**
     * Whether one person holds a password.
     *
     * Injected because "holds a password" is the credential service's
     * question, not this repository's: an account may still route to the
     * legacy store, and a `credential` row with no password in it is not a
     * way in either. Defaulting to "yes" would put the old bug back — the
     * blocker counted GRANTS, and a grant nobody can use satisfied "keep at
     * least one live way back in" while opening nothing.
     */
    private readonly holdsPassword: (args: {
      userId: string;
    }) => Promise<boolean> = async () => true,
  ) {}

  /**
   * Ways back in that can actually be walked.
   *
   * A live, unexpired, unsuperseded grant is necessary and not sufficient.
   * The holder has to hold the key too, and on an organization moving off a
   * brokered identity provider its administrators typically hold none —
   * their password lived at the provider. Counting grants let such an
   * organization finalize with no way back in at all.
   */
  private async countUsableRecoveries({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<number> {
    const live = await this.prisma.ssoBreakGlassBinding.findMany({
      where: {
        organizationId,
        supersededAt: null,
        expiresAt: { gt: new Date(this.now()) },
      },
      select: { userId: true },
      distinct: ["userId"],
    });
    return countUsableWaysBackIn({
      holders: live,
      holdsPassword: this.holdsPassword,
    });
  }

  async getProgress({
    organizationId,
    connectionId,
    cursor,
    limit,
  }: {
    organizationId: string;
    connectionId?: string;
    cursor: string | null;
    limit: number;
  }): Promise<SelfServeMigrationView | null> {
    const replacementRow = await this.prisma.ssoConnection.findFirst({
      where: {
        organizationId,
        ...(connectionId ? { id: connectionId } : {}),
        replacesConnectionId: { not: null },
        migrationPhase: { not: null },
        state: { notIn: ["DISCARDED", "TORN_DOWN"] },
      },
      orderBy: { createdAt: "desc" },
    });
    if (
      !replacementRow?.replacesConnectionId ||
      replacementRow.migrationPhase === null
    ) {
      return null;
    }
    const migrationPhase = replacementRow.migrationPhase;
    const legacyRow = await this.prisma.ssoConnection.findFirst({
      where: {
        id: replacementRow.replacesConnectionId,
        organizationId,
        source: "legacy-grandfathered",
      },
    });
    if (!legacyRow) return null;

    return this.progressFor({
      organizationId,
      replacement: rowToConnection(replacementRow),
      legacy: rowToConnection(legacyRow),
      migrationPhase,
      cursor,
      limit,
    });
  }

  /**
   * Everything the checklist counts, for one resolved legacy/replacement pair.
   *
   * Split from {@link getProgress} so the question "is there a migration here
   * at all" and the question "how far along is it" are answered in separate
   * places: the first can say no, and only the second needs the evidence.
   */
  private async progressFor({
    organizationId,
    replacement,
    legacy,
    migrationPhase,
    cursor,
    limit,
  }: {
    organizationId: string;
    replacement: ConnectionState;
    legacy: ConnectionState;
    migrationPhase: NonNullable<ConnectionState["migrationPhase"]>;
    cursor: string | null;
    limit: number;
  }): Promise<SelfServeMigrationView> {
    const evidence = await this.loadEvidence({
      organizationId,
      replacement,
      legacy,
      cursor,
      limit,
    });
    const {
      activeCount,
      linkedCount,
      lastLegacyAuthentication,
      liveRecoveryCount,
      legacyScim,
      replacementScim,
      replacementTest,
      sharedLegacyIdentifiers,
    } = evidence;

    const selectedRoute = routeOf(replacement.migrationPhase);
    const quietStartMs = Math.max(
      replacement.routeChangedAtMs ??
        replacement.graceStartedAtMs ??
        replacement.createdAtMs,
      lastLegacyAuthentication?.authenticatedAt.getTime() ?? 0,
    );
    const quietComplete =
      this.now() - quietStartMs >= MIGRATION_QUIET_PERIOD_MS;
    const scimStatus = scimStatusOf({
      legacySyncs: legacyScim !== null,
      replacementSyncState: replacementScim?.state,
    });
    const testSignIn = replacementTest
      ? { done: true, atMs: replacementTest.authenticatedAt.getTime() }
      : { done: false, atMs: null };
    const blockers = migrationBlockers({
      selectedRoute,
      testSignInDone: testSignIn.done,
      liveRecoveryCount,
      linkedCount,
      activeCount,
      quietComplete,
      scimStatus,
      sharedLegacyIdentifiers,
    });

    return {
      legacy: connectionRefOf(legacy),
      replacement: connectionRefOf(replacement),
      phase: migrationPhase,
      selectedRoute,
      inheritedDomains: inheritedDomainsOf({ replacement, legacy }),
      testSignIn,
      members: membersViewOf({ evidence, limit }),
      quietPeriod: {
        lastLegacyAuthenticationAtMs:
          lastLegacyAuthentication?.authenticatedAt.getTime() ?? null,
        complete: quietComplete,
      },
      scim: { status: scimStatus },
      blockers,
      canFinalize:
        blockers.length === 0 &&
        (replacement.migrationPhase === "GRACE_DIRECT" ||
          replacement.migrationPhase === "FINALIZING"),
    };
  }

  /**
   * Every count and row the checklist reads, in one round of queries.
   *
   * Gathered together rather than beside the branch that uses each one: they
   * are independent, so they belong in a single `Promise.all`, and keeping the
   * assembly above free of database calls is what makes it readable as the
   * shape of the answer.
   */
  /**
   * Every count and row the checklist reads.
   *
   * Two halves, started together: what the organization's members look like
   * against the replacement, and what the two connections themselves have been
   * doing. They share no inputs, so serialising them would only add latency.
   */
  private async loadEvidence({
    organizationId,
    replacement,
    legacy,
    cursor,
    limit,
  }: {
    organizationId: string;
    replacement: ConnectionState;
    legacy: ConnectionState;
    cursor: string | null;
    limit: number;
  }) {
    const [members, connections] = await Promise.all([
      this.loadMemberEvidence({
        organizationId,
        replacement,
        legacy,
        cursor,
        limit,
      }),
      this.loadConnectionEvidence({ organizationId, replacement, legacy }),
    ]);
    return { ...members, ...connections };
  }

  /**
   * Who is linked to the replacement and who is still a straggler.
   *
   * One row past the page is fetched so `membersViewOf` can tell whether a
   * next page exists; the legacy activity for the page is a second round,
   * because the ids it asks about are not known until the page is.
   */
  private async loadMemberEvidence({
    organizationId,
    replacement,
    legacy,
    cursor,
    limit,
  }: {
    organizationId: string;
    replacement: ConnectionState;
    legacy: ConnectionState;
    cursor: string | null;
    limit: number;
  }) {
    const { memberWhere, linkedWhere, stragglerWhere } = memberWhereClauses({
      organizationId,
      replacementConnectionId: replacement.connectionId,
      liveStates: [...LIVE_IDENTIFIER_STATES],
      cursor,
    });
    const [activeCount, linkedCount, stragglerRows] = await Promise.all([
      this.prisma.organizationUser.count({ where: memberWhere }),
      this.prisma.organizationUser.count({ where: linkedWhere }),
      this.prisma.organizationUser.findMany({
        where: stragglerWhere,
        orderBy: { userId: "asc" },
        take: limit + 1,
        select: {
          userId: true,
          user: { select: { name: true, email: true } },
        },
      }),
    ]);
    const pageRows = stragglerRows.slice(0, limit);
    const legacyActivityByUser = await this.latestLegacyActivityByUser({
      organizationId,
      connectionId: legacy.connectionId,
      userIds: pageRows.map((row) => row.userId),
    });
    return {
      activeCount,
      linkedCount,
      stragglerRows,
      pageRows,
      legacyActivityByUser,
    };
  }

  /** What the two connections have been doing: sign-ins, recovery, sync. */
  private async loadConnectionEvidence({
    organizationId,
    replacement,
    legacy,
  }: {
    organizationId: string;
    replacement: ConnectionState;
    legacy: ConnectionState;
  }) {
    const [
      replacementTest,
      lastLegacyAuthentication,
      liveRecoveryCount,
      legacyScim,
      replacementScim,
      legacyIdentifiers,
    ] = await Promise.all([
      this.prisma.ssoAuthenticationActivity.findFirst({
        where: { organizationId, connectionId: replacement.connectionId },
        orderBy: { authenticatedAt: "desc" },
      }),
      this.prisma.ssoAuthenticationActivity.findFirst({
        where: { organizationId, connectionId: legacy.connectionId },
        orderBy: { authenticatedAt: "desc" },
      }),
      this.countUsableRecoveries({ organizationId }),
      this.prisma.scimSyncState.findFirst({
        where: { organizationId, connectionId: legacy.connectionId },
      }),
      this.prisma.scimSyncState.findFirst({
        where: { organizationId, connectionId: replacement.connectionId },
      }),
      this.prisma.identifier.findMany({
        where: {
          connectionId: legacy.connectionId,
          state: { in: [...LIVE_IDENTIFIER_STATES] },
        },
        distinct: ["userId"],
        select: { userId: true },
      }),
    ]);
    const sharedLegacyIdentifiers = await this.hasSharedLegacyIdentifiers({
      organizationId,
      userIds: legacyIdentifiers.map((identifier) => identifier.userId),
    });
    return {
      replacementTest,
      lastLegacyAuthentication,
      liveRecoveryCount,
      legacyScim,
      replacementScim,
      sharedLegacyIdentifiers,
    };
  }

  private async latestLegacyActivityByUser({
    organizationId,
    connectionId,
    userIds,
  }: {
    organizationId: string;
    connectionId: string;
    userIds: string[];
  }): Promise<Map<string, Date>> {
    if (userIds.length === 0) return new Map();
    const rows = await this.prisma.ssoAuthenticationActivity.findMany({
      where: { organizationId, connectionId, userId: { in: userIds } },
      orderBy: { authenticatedAt: "desc" },
    });
    const latest = new Map<string, Date>();
    for (const row of rows) {
      if (!latest.has(row.userId)) latest.set(row.userId, row.authenticatedAt);
    }
    return latest;
  }

  private async hasSharedLegacyIdentifiers({
    organizationId,
    userIds,
  }: {
    organizationId: string;
    userIds: string[];
  }): Promise<boolean> {
    if (userIds.length === 0) return false;
    const otherMemberships = await this.prisma.organizationUser.findMany({
      where: {
        userId: { in: userIds },
        organizationId: { not: organizationId },
      },
      distinct: ["organizationId"],
      select: { organizationId: true },
    });
    if (otherMemberships.length === 0) return false;
    return (
      (await this.prisma.ssoConnection.count({
        where: {
          organizationId: {
            in: otherMemberships.map((membership) => membership.organizationId),
          },
          source: "legacy-grandfathered",
          state: { notIn: ["DISCARDED", "TORN_DOWN"] },
        },
      })) > 0
    );
  }
}

/**
 * How many of these grants somebody could actually walk through.
 *
 * Separated from the query so the rule is testable without standing up the
 * whole progress read: the defect it replaces was arithmetic, not SQL — the
 * blocker counted grants, and a grant whose holder has no password opens
 * nothing.
 */
export async function countUsableWaysBackIn({
  holders,
  holdsPassword,
}: {
  holders: readonly { userId: string }[];
  holdsPassword: (args: { userId: string }) => Promise<boolean>;
}): Promise<number> {
  const usable = await Promise.all(
    holders.map((holder) => holdsPassword({ userId: holder.userId })),
  );
  return usable.filter(Boolean).length;
}

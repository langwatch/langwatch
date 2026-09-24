import type { LegacySsoAccessQuery } from "@langwatch/auth-contract";
import {
  breakGlassIsLive,
  SsoConnectionInvalidTransitionError,
  ssoMigrationRouteOf,
  type SsoConnectionLifecycleState,
  type SsoConnectionState,
  type SsoMigrationBlockerView,
  type SsoMigrationPhase,
  type SsoMigrationScimStatus,
  type SsoMigrationView,
} from "@langwatch/identity-contract";
import { nowInstant } from "@langwatch/time";

import type { SsoBreakGlassRepository } from "../repositories/sso-break-glass.repository.ts";
import type { SsoConnectionReadRepository } from "../repositories/sso-connection.repository.ts";
import type { SsoMigrationEvidenceRepository } from "../repositories/sso-migration-evidence.repository.ts";
import {
  connectionRefOf,
  identifierBelongsToMigrationConnection,
  legacyStandingOf,
  inheritedDomainsOf,
  memberMovesOf,
  membersViewOf,
  migrationBlockers,
  quietPeriodOf,
  scimStatusOf,
} from "../rules/sso-migration.rules.ts";

/** A connection nobody can act on any further is not half of a live pair. */
const CLOSED_STATES = new Set(["DISCARDED", "TORN_DOWN"]);

/** One active member, as the organization module answers for them. */
export interface SsoMigrationMember {
  userId: string;
  name: string | null;
  email: string | null;
}

/** Who is in the organization today. The rows are the organization's, so
 *  they are asked for rather than queried (ADR-129). */
export interface SsoMigrationMemberships {
  listActiveMembers(args: { organizationId: string }): Promise<SsoMigrationMember[]>;
}

/**
 * Where directory provisioning points, when a directory module is installed.
 * Unanswered means this installation provisions nobody, which is what
 * `not-applicable` says.
 */
export interface SsoMigrationDirectoryReads {
  readSyncStatus(args: {
    organizationId: string;
    legacyConnectionId: string;
    replacementConnectionId: string;
  }): Promise<SsoMigrationScimStatus>;
}

/**
 * The federated accounts a connection minted, counted by the module that owns
 * them (ADR-129). Identity reads no `Account` row of its own, so whether
 * legacy access is gone is somebody else's answer.
 */
export interface SsoLegacyAccessReads {
  count(args: LegacySsoAccessQuery): Promise<number>;
}

/** The facts finalization must re-read before and after every durable step. */
export interface SsoMigrationFinalizationEvidence {
  legacyConnectionId: string;
  legacyState: SsoConnectionLifecycleState;
  phase: SsoMigrationPhase;
  blockers: readonly SsoMigrationBlockerView[];
  /** No live identifier and no federated account still belongs to the
   *  connection being retired. */
  legacyAccessRetired: boolean;
}

export interface SsoMigrationProgressServiceDeps {
  connections: SsoConnectionReadRepository;
  evidence: SsoMigrationEvidenceRepository;
  breakGlass: SsoBreakGlassRepository;
  memberships: SsoMigrationMemberships;
  legacyAccess: SsoLegacyAccessReads;
  directory?: SsoMigrationDirectoryReads;
  now?: () => number;
}

/** The cutover, when the organization is running one. A reading rather than
 *  a nullable answer: "no migration" is an ordinary state, not an absence
 *  the caller has to treat as a failure. */
export interface SsoMigrationReading {
  migration: SsoMigrationView | null;
}

/** The pair, and the page size the journey asks for. */
export interface SsoMigrationProgressRequest {
  organizationId: string;
  /** Which replacement, when the caller names one; the newest otherwise. */
  connectionId?: string;
  cursor: string | null;
  limit: number;
}

interface MigrationPair {
  replacement: SsoConnectionState;
  legacy: SsoConnectionState;
}

/**
 * How far one organization's legacy-to-direct cutover has come. A read, and
 * a fresh one every time: what finalization refuses on is re-read here, so
 * a screen can never hand a stale verdict to the verb.
 */
export class SsoMigrationProgressService {
  static create(deps: SsoMigrationProgressServiceDeps): SsoMigrationProgressService {
    return new SsoMigrationProgressService(deps);
  }

  private readonly now: () => number;

  private constructor(private readonly deps: SsoMigrationProgressServiceDeps) {
    this.now = deps.now ?? (() => nowInstant().epochMilliseconds);
  }

  async getProgress({
    organizationId,
    connectionId,
    cursor,
    limit,
  }: SsoMigrationProgressRequest): Promise<SsoMigrationReading> {
    const pair = await this.findPair({ organizationId, connectionId });
    if (!pair) return { migration: null };

    const { replacement, legacy } = pair;
    const phase = replacement.migrationPhase ?? "SETUP";
    const members = await this.deps.memberships.listActiveMembers({ organizationId });
    const holdings = await this.deps.evidence.findLiveIdentifierHoldings({
      userIds: members.map((member) => member.userId),
    });
    const linkedUserIds = new Set(
      holdings
        .filter((holding) =>
          identifierBelongsToMigrationConnection({ identifier: holding, connection: replacement }),
        )
        .map((holding) => holding.userId),
    );
    const stragglerIds = members
      .map((member) => member.userId)
      .filter((userId) => !linkedUserIds.has(userId))
      .toSorted()
      .filter((userId) => cursor === null || userId > cursor);
    const pageIds = stragglerIds.slice(0, limit);
    const byId = new Map(members.map((member) => [member.userId, member]));
    const notYetMoved = members.filter((member) => !linkedUserIds.has(member.userId));

    const [replacementLast, legacyLast, legacyActivityByUser, bindings, scimStatus, holders] =
      await Promise.all([
        this.deps.evidence.findLastAuthenticationAtMs({
          organizationId,
          connectionId: replacement.connectionId,
        }),
        this.deps.evidence.findLastAuthenticationAtMs({
          organizationId,
          connectionId: legacy.connectionId,
        }),
        this.deps.evidence.findLastAuthenticationByUser({
          organizationId,
          connectionId: legacy.connectionId,
          userIds: pageIds,
        }),
        this.deps.breakGlass.findAllForOrganization({ organizationId }),
        this.readScimStatus(pair),
        this.deps.evidence.countAddressHolders({
          addresses: notYetMoved.flatMap((member) => (member.email ? [member.email] : [])),
        }),
      ]);

    const nowMs = this.now();
    const linkedCount = members.filter((member) => linkedUserIds.has(member.userId)).length;
    const selectedRoute = ssoMigrationRouteOf(phase);
    const quiet = quietPeriodOf({
      switchedOverAtMs:
        selectedRoute === "direct"
          ? (replacement.routeChangedAtMs ??
            replacement.graceStartedAtMs ??
            replacement.createdAtMs)
          : null,
      lastLegacyAuthenticationAtMs: legacyLast,
      nowMs,
    });
    const testSignIn = {
      done: replacementLast !== null || replacement.testLoginAccountId !== null,
      atMs: replacementLast,
    };
    const blockers = migrationBlockers({
      selectedRoute,
      testSignInDone: testSignIn.done,
      liveRecoveryCount: bindings.filter((binding) => breakGlassIsLive({ binding, nowMs })).length,
      quietComplete: quiet.complete,
      scimStatus,
      sharedLegacyIdentifiers: false,
    });

    const migration: SsoMigrationView = {
      legacy: connectionRefOf(legacy),
      replacement: connectionRefOf(replacement),
      phase,
      selectedRoute,
      inheritedDomains: inheritedDomainsOf({ replacement, legacy }),
      testSignIn,
      members: membersViewOf({
        evidence: {
          activeCount: members.length,
          linkedCount,
          stragglerIds,
          pageRows: pageIds.map((userId) => ({
            userId,
            name: byId.get(userId)?.name ?? null,
            email: byId.get(userId)?.email ?? null,
          })),
          legacyActivityByUser,
          moves: memberMovesOf({ members: notYetMoved, holders, replacement }),
        },
        limit,
      }),
      quietPeriod: { lastLegacyAuthenticationAtMs: legacyLast, ...quiet },
      scim: { status: scimStatus },
      blockers,
      canFinalize: blockers.length === 0 && (phase === "GRACE_DIRECT" || phase === "FINALIZING"),
    };

    return { migration };
  }

  /**
   * The same reading, as the finalization verb asks for it: no paging, and
   * the legacy half's own standing beside the blockers. An organization
   * running no cutover has nothing to finalize, and is refused by name.
   */
  async getFinalizationEvidence({
    organizationId,
    connectionId,
  }: {
    organizationId: string;
    connectionId?: string;
  }): Promise<SsoMigrationFinalizationEvidence> {
    const pair = await this.findPair({ organizationId, connectionId });
    const { migration } = pair
      ? await this.getProgress({
          organizationId,
          connectionId: pair.replacement.connectionId,
          cursor: null,
          limit: 0,
        })
      : { migration: null };
    if (!pair || !migration) {
      throw new SsoConnectionInvalidTransitionError(
        `organization ${organizationId} is running no legacy migration pair`,
      );
    }

    return {
      legacyConnectionId: pair.legacy.connectionId,
      legacyState: pair.legacy.state,
      phase: migration.phase,
      blockers: migration.blockers,
      legacyAccessRetired: await this.legacyAccessRetired(pair.legacy),
    };
  }

  /** Both halves of "nothing lets anybody in through the old connection any
   *  more": identity's live identifiers, and auth's account rows. */
  private async legacyAccessRetired(legacy: SsoConnectionState): Promise<boolean> {
    const members = await this.deps.memberships.listActiveMembers({
      organizationId: legacy.organizationId,
    });
    const userIds = members.map((member) => member.userId);
    const holdings = await this.deps.evidence.findLiveIdentifierHoldings({ userIds });
    const { legacyIdentifierIds, strandedUserIds } = legacyStandingOf({ holdings, legacy });
    const held = holdings.some(
      (holding) =>
        legacyIdentifierIds.has(holding.identifierId) && !strandedUserIds.has(holding.userId),
    );
    if (held) return false;

    const accounts = await this.deps.legacyAccess.count({
      organizationId: legacy.organizationId,
      connectionId: legacy.connectionId,
      strandedUserIds: [...strandedUserIds],
    });

    return accounts === 0;
  }

  private async readScimStatus(pair: MigrationPair): Promise<SsoMigrationScimStatus> {
    if (!this.deps.directory)
      return scimStatusOf({ legacySyncs: false, replacementSyncState: null });

    return this.deps.directory.readSyncStatus({
      organizationId: pair.legacy.organizationId,
      legacyConnectionId: pair.legacy.connectionId,
      replacementConnectionId: pair.replacement.connectionId,
    });
  }

  private async findPair({
    organizationId,
    connectionId,
  }: {
    organizationId: string;
    connectionId?: string;
  }): Promise<MigrationPair | null> {
    const held = await this.deps.connections.findForOrganization({ organizationId });
    const replacement = held.find(
      (connection) =>
        connection.replacesConnectionId !== null &&
        connection.migrationPhase !== null &&
        !CLOSED_STATES.has(connection.state) &&
        (connectionId === undefined || connection.connectionId === connectionId),
    );
    if (!replacement?.replacesConnectionId) return null;

    const legacy = held.find(
      (connection) =>
        connection.connectionId === replacement.replacesConnectionId &&
        connection.source === "legacy-grandfathered",
    );

    return legacy ? { replacement, legacy } : null;
  }
}

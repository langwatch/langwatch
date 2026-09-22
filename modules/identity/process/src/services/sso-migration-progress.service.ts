import {
  breakGlassIsLive,
  ssoMigrationRouteOf,
  type SsoConnectionState,
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
  inheritedDomainsOf,
  membersViewOf,
  MIGRATION_QUIET_PERIOD_MS,
  migrationBlockers,
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

export interface SsoMigrationProgressServiceDeps {
  connections: SsoConnectionReadRepository;
  evidence: SsoMigrationEvidenceRepository;
  breakGlass: SsoBreakGlassRepository;
  memberships: SsoMigrationMemberships;
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

    const [replacementLast, legacyLast, legacyActivityByUser, bindings, scimStatus] =
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
      ]);

    const nowMs = this.now();
    const linkedCount = members.filter((member) => linkedUserIds.has(member.userId)).length;
    const selectedRoute = ssoMigrationRouteOf(phase);
    // The quiet period starts at the later of the route decision and the last
    // legacy sign-in: choosing the direct route does not make the week
    // already served, and neither does a sign-in during it.
    const quietStartMs = Math.max(
      replacement.routeChangedAtMs ?? replacement.graceStartedAtMs ?? replacement.createdAtMs,
      legacyLast ?? 0,
    );
    const quietComplete = nowMs - quietStartMs >= MIGRATION_QUIET_PERIOD_MS;
    const testSignIn = {
      done: replacementLast !== null || replacement.testLoginAccountId !== null,
      atMs: replacementLast,
    };
    const blockers = migrationBlockers({
      selectedRoute,
      testSignInDone: testSignIn.done,
      liveRecoveryCount: bindings.filter((binding) => breakGlassIsLive({ binding, nowMs })).length,
      linkedCount,
      activeCount: members.length,
      quietComplete,
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
        },
        limit,
      }),
      quietPeriod: { lastLegacyAuthenticationAtMs: legacyLast, complete: quietComplete },
      scim: { status: scimStatus },
      blockers,
      canFinalize: blockers.length === 0 && (phase === "GRACE_DIRECT" || phase === "FINALIZING"),
    };

    return { migration };
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

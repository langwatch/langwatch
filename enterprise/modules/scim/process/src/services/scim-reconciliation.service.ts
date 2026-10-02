// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The organization's view of its directory sync (ADR-122).
 *
 * Composed from four owners rather than queried: identity answers which
 * connections exist, authz answers what the directory changed, the user
 * module answers who those people are, and each sync and the directory
 * ownership rows are this module's own. Nothing here reads a table another module
 * owns, which is the whole reason the view is assembled in a service.
 *
 * Organization-scoped by construction: every read is BUILT from the
 * organization the session resolved, so naming another organization's
 * connection reads exactly like naming one that does not exist.
 *
 * See enterprise/modules/scim/specs/scim-reconciliation-surfaces.feature.
 */
import type { AuthzApi } from "@langwatch/authz-contract";
import {
  DIRECTORY_ACTIVITY_LIMIT,
  RECENT_DIRECTORY_CHANGE_LIMIT,
  type ConnectionReconciliation,
  type OrganizationReconciliation,
  type ScimDirectoryActivityEntry,
  type ScimReconciliationChange,
  type ScimReconciliationFailure,
  type ScimService,
  type ScimSyncState,
} from "@langwatch/enterprise-scim-contract";
import type { IdentityApi, OrganizationSsoConnection } from "@langwatch/identity-contract";
import type { UserApi } from "@langwatch/user-contract";

import {
  DIRECTORY_CHANGE_AUTHOR,
  DIRECTORY_FAILURE_REMEDIATION,
  directoryActivityCopy,
  directoryChangeCopy,
  directoryFailureCopy,
  scimSyncStatusCopy,
} from "../rules/scim-reconciliation-copy.rules.ts";
import type { ScimSyncReadsService } from "./scim-sync-reads.service.ts";

/** Every answer this view is assembled from, each from the module that owns it. */
export type ScimReconciliationReads = {
  /** The organization's connections. Identity owns those rows. */
  identity: Pick<IdentityApi, "ssoConnectionReads">;
  /** Where each connection's sync stands. This module's own fold. */
  syncs: Pick<ScimSyncReadsService, "findForOrganization" | "findByConnection" | "findActivity">;
  /** What the directory attached and took back. Authz owns those rows. */
  grants: Pick<AuthzApi, "findDirectoryCausedChanges">;
  /** Who a change was about, so a reader sees a name rather than an id. */
  people: Pick<UserApi, "getProfiles">;
  /** Whom each connection's directory has claimed. This module's own rows. */
  directory: Pick<ScimService, "findDirectoryOwnership">;
};

export class ScimReconciliationService {
  private constructor(private readonly reads: ScimReconciliationReads) {}

  static create(reads: ScimReconciliationReads): ScimReconciliationService {
    return new ScimReconciliationService(reads);
  }

  async getAll({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<OrganizationReconciliation> {
    const [connections, syncs] = await Promise.all([
      this.reads.identity.ssoConnectionReads().findForOrganization({ organizationId }),
      this.reads.syncs.findForOrganization({ organizationId }),
    ]);
    const syncOf = new Map(syncs.map((sync) => [sync.connectionId, sync]));
    const [managed, recentChanges] = await Promise.all([
      this.#countManagedPeople({
        connectionIds: connections.map((connection) => connection.connectionId),
      }),
      this.#recentChanges({ organizationId }),
    ]);

    return {
      connections: connections.map((connection) =>
        toConnectionReconciliation({
          connection,
          sync: syncOf.get(connection.connectionId) ?? null,
          managedPeople: managed.get(connection.connectionId) ?? 0,
        }),
      ),
      recentChanges,
    };
  }

  /** One connection's panel, built from this organization's list so another's never enters it. */
  async findById({
    organizationId,
    connectionId,
  }: {
    organizationId: string;
    connectionId: string;
  }): Promise<ConnectionReconciliation[]> {
    const connections = await this.reads.identity
      .ssoConnectionReads()
      .findForOrganization({ organizationId });
    const connection = connections.find((candidate) => candidate.connectionId === connectionId);
    if (!connection) return [];

    const [sync, managed] = await Promise.all([
      this.reads.syncs.findByConnection({ organizationId, connectionId }),
      this.#countManagedPeople({ connectionIds: [connectionId] }),
    ]);

    return [
      toConnectionReconciliation({
        connection,
        sync,
        managedPeople: managed.get(connectionId) ?? 0,
      }),
    ];
  }

  /**
   * What one connection's directory did, newest first (ADR-126). Identity
   * scans the log in this organization's tenant; the people are named in one
   * lookup rather than once a line.
   */
  async findActivity({
    organizationId,
    connectionId,
  }: {
    organizationId: string;
    connectionId: string;
  }): Promise<ScimDirectoryActivityEntry[]> {
    const entries = await this.reads.syncs.findActivity({
      organizationId,
      connectionId,
      limit: DIRECTORY_ACTIVITY_LIMIT,
    });
    const names = await this.#peopleNames({
      userIds: entries
        .map((entry) => entry.userId)
        .filter((userId): userId is string => userId !== null),
    });

    return entries.map((entry) => ({
      eventId: entry.eventId,
      occurredAtMs: entry.occurredAtMs,
      outcome: entry.outcome,
      summary: directoryActivityCopy({
        type: entry.type,
        op: entry.op,
        person: entry.userId ? (names.get(entry.userId) ?? null) : null,
        failure: entry.errorCode ? directoryFailureCopy(entry.errorCode).title : null,
      }),
    }));
  }

  /**
   * How many people each connection's directory manages.
   *
   * A person the directory claimed and the product has since erased is not
   * one it manages, so the count is the claims whose person identity still
   * answers for — and one person claimed under two identifiers is one person.
   */
  async #countManagedPeople({
    connectionIds,
  }: {
    connectionIds: string[];
  }): Promise<Map<string, number>> {
    if (connectionIds.length === 0) return new Map();

    const ownership = await this.reads.directory.findDirectoryOwnership({ connectionIds });
    if (ownership.length === 0) return new Map();

    const present = await this.#peopleNames({ userIds: ownership.map((row) => row.userId) });
    const counted = new Set<string>();
    const counts = new Map<string, number>();
    for (const { connectionId, userId } of ownership) {
      const pair = `${connectionId}\0${userId}`;
      if (!present.has(userId) || counted.has(pair)) continue;
      counted.add(pair);
      counts.set(connectionId, (counts.get(connectionId) ?? 0) + 1);
    }

    return counts;
  }

  async #recentChanges({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<ScimReconciliationChange[]> {
    const changes = await this.reads.grants.findDirectoryCausedChanges({
      organizationId,
      limit: RECENT_DIRECTORY_CHANGE_LIMIT,
    });
    const names = await this.#peopleNames({
      userIds: changes
        .map((change) => change.userId)
        .filter((userId): userId is string => userId !== null),
    });

    return changes.map((change) => ({
      grantId: change.grantId,
      summary: directoryChangeCopy({
        kind: change.kind,
        person: change.userId ? (names.get(change.userId) ?? null) : null,
      }),
      author: DIRECTORY_CHANGE_AUTHOR,
      occurredAtMs: change.occurredAtMs,
      kind: change.kind,
    }));
  }

  /**
   * The people behind a set of ids, in one lookup: a page about four people
   * asks once rather than once a line. Name before address — a removal is
   * read by somebody checking whether the right person left.
   */
  async #peopleNames({ userIds }: { userIds: string[] }): Promise<Map<string, string>> {
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return new Map();

    const profiles = await this.reads.people.getProfiles({ userIds: unique });

    return new Map(
      profiles.map((profile) => [profile.id, profile.name ?? profile.email ?? profile.id] as const),
    );
  }
}

function toConnectionReconciliation({
  connection,
  sync,
  managedPeople,
}: {
  connection: OrganizationSsoConnection;
  /** Null for a connection no token has ever been minted against. */
  sync: ScimSyncState | null;
  managedPeople: number;
}): ConnectionReconciliation {
  return {
    connectionId: connection.connectionId,
    providerId: connection.providerId,
    verifiedDomains: connection.verifiedDomains,
    connectionState: connection.state,
    state: sync?.state ?? null,
    status: scimSyncStatusCopy({
      state: sync?.state ?? null,
      hasPushed: sync?.lastPushedAtMs != null,
      revokedCause: sync?.revokedCause ?? null,
    }),
    lastPushedAtMs: sync?.lastPushedAtMs ?? null,
    managedPeople,
    failures: sync ? failuresOf(sync) : [],
    remediation: DIRECTORY_FAILURE_REMEDIATION,
  };
}

/**
 * The failures a customer sees: every dead letter, plus the failure standing
 * right now when it is not already among them. Dead letters first, because
 * they are the ones nothing will fix on its own.
 */
function failuresOf(sync: ScimSyncState): ScimReconciliationFailure[] {
  const standing =
    sync.lastFailure && sync.lastFailure.retiredAtMs === null ? [sync.lastFailure] : [];

  return [...sync.deadLetters, ...standing].map((failure) => ({
    ...directoryFailureCopy(failure.errorCode),
    occurredAtMs: failure.occurredAtMs,
    retired: failure.retiredAtMs !== null,
  }));
}

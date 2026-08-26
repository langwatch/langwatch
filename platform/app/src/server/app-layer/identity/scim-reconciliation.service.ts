/**
 * The organization's view of its directory sync (ADR-122).
 *
 * Read-only, and organization-scoped at the DATA layer: every method takes
 * the organization the session resolved and builds its query from it. There
 * is no method here a caller can pass another organization's connection to
 * and get an answer from — naming one answers exactly as naming a connection
 * that does not exist does, because the query never found it.
 *
 * What it hands the page is WORDS. The projection holds a lifecycle state and
 * a reason code; neither is something a customer should have to read, so the
 * translation happens here (`scim-reconciliation-copy.ts` for the sync state,
 * the code-keyed error registry for a failure) and the page renders what it
 * is given. A page that reached for the code itself would be a second place
 * the copy lives.
 *
 * See specs/identity/scim-reconciliation-surfaces.feature.
 */
import type {
  ScimSyncLifecycleState,
  ScimSyncState,
} from "@langwatch/identity";
import { explainHandledError } from "~/features/errors/logic/presentation";
import type {
  DirectoryCausedChange,
  OrganizationConnection,
  ScimReconciliationReadRepository,
} from "./repositories/scim-reconciliation.prisma.repository";
import { RECENT_DIRECTORY_CHANGE_LIMIT } from "./repositories/scim-reconciliation.prisma.repository";
import type {
  DirectoryActivityEntry,
  ScimSyncActivityReadRepository,
} from "./repositories/scim-sync-event-log.repository";
import {
  DIRECTORY_CHANGE_AUTHOR,
  DIRECTORY_FAILURE_REMEDIATION,
  directoryActivityCopy,
  directoryChangeCopy,
  type ScimSyncStatusCopy,
  scimSyncStatusCopy,
} from "./scim-reconciliation-copy";

/** One failed apply, as a customer reads it. */
export interface ReconciliationFailure {
  /** What went wrong, in words. Never the reason code. */
  title: string;
  /** What will resolve it. */
  description: string;
  occurredAtMs: number;
  /** Whether it has stopped being retried. */
  retired: boolean;
}

/** One change the directory made, as a customer reads it. */
export interface ReconciliationChange {
  /** The grant this change IS. Both this panel and the audit page name it,
   *  which is what makes them the same story rather than two accounts. */
  grantId: string;
  summary: string;
  author: string;
  occurredAtMs: number;
  kind: "attached" | "removed";
}

/** One connection's reconciliation panel. */
export interface ConnectionReconciliation {
  connectionId: string;
  /** The identity provider the connection names, so a reader can tell two
   *  connections apart by something other than an identifier. */
  providerId: string;
  verifiedDomains: string[];
  /**
   * Where the CONNECTION stands, as opposed to where its sync does.
   *
   * Two different lifecycles were being reported through one field. `state`
   * below is the sync's — has a token ever pushed, is it revoked — and a
   * connection that was withdrawn before it ever went live has no sync at
   * all, so it arrived on the page as a connection with no status beside
   * every connection that is genuinely running. A reader looking at a list
   * of four could not tell which two were history.
   */
  connectionState: string;
  /** Null for a connection no token has ever been minted against. */
  state: ScimSyncLifecycleState | null;
  status: ScimSyncStatusCopy;
  lastPushedAtMs: number | null;
  managedPeople: number;
  failures: ReconciliationFailure[];
  /** The copy that stands where a retry control would have gone. */
  remediation: string;
}

export interface OrganizationReconciliation {
  connections: ConnectionReconciliation[];
  recentChanges: ReconciliationChange[];
}

/**
 * One line of what the directory has been doing (ADR-126).
 *
 * The sequence, as against `status`, which is where the connection stands.
 * Somebody who configured a provider a minute ago is asking whether what they
 * just did arrived, and a folded head cannot answer that — it says the same
 * thing whether the last push was one event or four hundred.
 */
export interface DirectoryActivityEntryView {
  /** The event this line IS, so a re-render cannot reorder or duplicate it. */
  eventId: string;
  summary: string;
  occurredAtMs: number;
  outcome: "ok" | "refused";
}

/** How many lines the feed carries. The question it answers is about the last
 *  few minutes, so it is bounded rather than paged: a page control here would
 *  invite reading it as an audit trail, which the audit page already is. */
export const DIRECTORY_ACTIVITY_LIMIT = 25;

export class ScimReconciliationService {
  constructor(
    private readonly deps: {
      reads: ScimReconciliationReadRepository;
      /** The scim_sync log, read as a sequence (ADR-126). */
      activity: ScimSyncActivityReadRepository;
    },
  ) {}

  /**
   * What the directory has been doing on one connection, newest first.
   *
   * Organization-scoped the way every other read here is, and structurally so:
   * the log is scanned in this organization's tenant, so another
   * organization's connection is not filtered out — it is never found, which
   * is the same answer a connection that does not exist gets.
   *
   * The people are resolved in one lookup rather than per line, the way the
   * recent-changes list does it: a feed of twenty pushes about four people is
   * four names, and asking twenty times would be twenty queries to say them.
   */
  async getActivity({
    organizationId,
    connectionId,
    limit = DIRECTORY_ACTIVITY_LIMIT,
  }: {
    organizationId: string;
    connectionId: string;
    limit?: number;
  }): Promise<DirectoryActivityEntryView[]> {
    const entries = await this.deps.activity.findActivity({
      organizationId,
      connectionId,
      limit,
    });
    const names = await this.deps.reads.findPeopleNames({
      userIds: entries
        .map((entry) => entry.userId)
        .filter((userId): userId is string => userId !== null),
    });
    return entries.map((entry) => toActivityView({ entry, names }));
  }

  /**
   * Every connection of this organization that has a directory sync, with
   * what the directory has been doing.
   */
  async getAll({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<OrganizationReconciliation> {
    const [connections, syncs] = await Promise.all([
      this.deps.reads.findAllConnections({ organizationId }),
      this.deps.reads.findAllSyncsForOrganization({ organizationId }),
    ]);
    const syncOf = new Map(syncs.map((sync) => [sync.connectionId, sync]));
    const managed = await this.deps.reads.countManagedPeople({
      connectionIds: connections.map((connection) => connection.connectionId),
    });
    return {
      connections: connections.map((connection) =>
        toConnectionReconciliation({
          connection,
          sync: syncOf.get(connection.connectionId) ?? null,
          managedPeople: managed.get(connection.connectionId) ?? 0,
        }),
      ),
      recentChanges: await this.recentChanges({ organizationId }),
    };
  }

  /**
   * One connection's panel. Answers null for a connection this organization
   * does not have — including one that belongs to somebody else, which reads
   * identically on purpose.
   */
  async getById({
    organizationId,
    connectionId,
  }: {
    organizationId: string;
    connectionId: string;
  }): Promise<ConnectionReconciliation | null> {
    const connections = await this.deps.reads.findAllConnections({
      organizationId,
    });
    const connection = connections.find(
      (candidate) => candidate.connectionId === connectionId,
    );
    // Not there for THIS organization, which is the only question asked. A
    // connection belonging to somebody else never entered the list, so this
    // answers null without the refusal having to know that it exists.
    if (!connection) return null;
    const [sync, managed] = await Promise.all([
      this.deps.reads.findSyncByIdForOrganization({
        organizationId,
        connectionId,
      }),
      this.deps.reads.countManagedPeople({ connectionIds: [connectionId] }),
    ]);
    return toConnectionReconciliation({
      connection,
      sync,
      managedPeople: managed.get(connectionId) ?? 0,
    });
  }

  private async recentChanges({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<ReconciliationChange[]> {
    const changes = await this.deps.reads.findDirectoryCausedChanges({
      organizationId,
      limit: RECENT_DIRECTORY_CHANGE_LIMIT,
    });
    const names = await this.deps.reads.findPeopleNames({
      userIds: changes
        .map((change) => change.userId)
        .filter((userId): userId is string => userId !== null),
    });
    return changes.map((change) => toReconciliationChange({ change, names }));
  }
}

function toReconciliationChange({
  change,
  names,
}: {
  change: DirectoryCausedChange;
  names: Map<string, string>;
}): ReconciliationChange {
  return {
    grantId: change.grantId,
    summary: directoryChangeCopy({
      kind: change.kind,
      person: change.userId ? (names.get(change.userId) ?? null) : null,
    }),
    // Always the directory, and never a person: what makes this list worth
    // having is that it tells a change nobody in the organization made apart
    // from one an administrator made by hand.
    author: DIRECTORY_CHANGE_AUTHOR,
    occurredAtMs: change.occurredAtMs,
    kind: change.kind,
  };
}

/**
 * One logged fact as a line of the feed.
 *
 * A failure's words come from the code-keyed registry, exactly as the failure
 * panel's do — the same code has to read the same way in both places, or the
 * page tells one story twice differently.
 */
function toActivityView({
  entry,
  names,
}: {
  entry: DirectoryActivityEntry;
  names: Map<string, string>;
}): DirectoryActivityEntryView {
  return {
    eventId: entry.eventId,
    occurredAtMs: entry.occurredAtMs,
    outcome: entry.outcome,
    summary: directoryActivityCopy({
      type: entry.type,
      op: entry.op,
      person: entry.userId ? (names.get(entry.userId) ?? null) : null,
      failure: entry.errorCode ? failureWords(entry.errorCode) : null,
    }),
  };
}

/** A reason code as the words every other error surface gives it. */
function failureWords(errorCode: string): string {
  return explainHandledError({
    code: errorCode,
    meta: {},
    httpStatus: 500,
    fault: "platform",
    tips: [],
    docsUrl: undefined,
    traceId: undefined,
    reasons: [],
  }).title;
}

function toConnectionReconciliation({
  connection,
  sync,
  managedPeople,
}: {
  connection: OrganizationConnection;
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
 * right now when it is not already among them.
 *
 * Dead letters first because they are the ones nothing will fix on its own.
 * Each one becomes words through the code-keyed registry — the same registry
 * every other error in the product reads from — so a reason code never
 * reaches the page, and a code we have no copy for degrades to the humanised
 * code rather than to a blank line.
 */
function failuresOf(sync: ScimSyncState): ReconciliationFailure[] {
  const standing =
    sync.lastFailure && sync.lastFailure.retiredAtMs === null
      ? [sync.lastFailure]
      : [];
  return [...sync.deadLetters, ...standing].map((failure) => {
    const explained = explainHandledError({
      code: failure.errorCode,
      meta: {},
      httpStatus: 500,
      fault: "platform",
      tips: [],
      docsUrl: undefined,
      traceId: undefined,
      reasons: [],
    });
    return {
      title: explained.title,
      description: explained.description || DIRECTORY_FAILURE_REMEDIATION,
      occurredAtMs: failure.occurredAtMs,
      retired: failure.retiredAtMs !== null,
    };
  });
}

import { SYSTEM_ACTORS } from "@langwatch/actor";
import type { GrantEventSource } from "@langwatch/authz-server";
import { createLogger } from "@langwatch/observability";
import type { SubscriberSpec } from "../../../pipeline/processManagerDefinition";
import {
  AUTHZ_AUDIT_ACTION_PREFIX,
  type AuthzAuditVerb,
  GRANT_ATTACHED_EVENT_TYPE,
  GRANT_REVOKED_EVENT_TYPE,
  GRANT_ROLE_CHANGED_EVENT_TYPE,
  ROLE_DEFINED_EVENT_TYPE,
  ROLE_DELETED_EVENT_TYPE,
  ROLE_PERMISSIONS_CHANGED_EVENT_TYPE,
} from "../schemas/constants";
import type { AuthzGrantsEvent } from "../schemas/events";

/**
 * Every authorization event is an access fact, so every one of them audits.
 *
 * The operator-facing events this list used to exclude — the cutover
 * machine's moves and the migration runner's witnessed transitions — are
 * gone with the model that had them (ADR-110).
 */
export const AUTHZ_AUDIT_EVENT_TYPES = [
  GRANT_ATTACHED_EVENT_TYPE,
  GRANT_ROLE_CHANGED_EVENT_TYPE,
  GRANT_REVOKED_EVENT_TYPE,
  ROLE_DEFINED_EVENT_TYPE,
  ROLE_PERMISSIONS_CHANGED_EVENT_TYPE,
  ROLE_DELETED_EVENT_TYPE,
] as const;

/**
 * Deliberately empty, and kept rather than deleted: the two lists together
 * must cover the wire union exactly (`authzAuditTrail.subscriber.unit.test.ts`),
 * so a new event type that nobody classified fails a test instead of reaching
 * the audit page as `authz.grants.undefined` or being silently dropped.
 */
export const AUTHZ_NON_AUDIT_EVENT_TYPES = [] as const;

type AuditableEventType = (typeof AUTHZ_AUDIT_EVENT_TYPES)[number];

/** Stable verbs. The event type is a wire name that may gain a version
 *  suffix; the audit `action` is a customer-facing string that must not
 *  move once a row carries it. */
const AUDIT_VERB_BY_EVENT_TYPE: Record<AuditableEventType, AuthzAuditVerb> = {
  [GRANT_ATTACHED_EVENT_TYPE]: "attach",
  [GRANT_ROLE_CHANGED_EVENT_TYPE]: "role_change",
  [GRANT_REVOKED_EVENT_TYPE]: "revoke",
  [ROLE_DEFINED_EVENT_TYPE]: "role_defined",
  [ROLE_PERMISSIONS_CHANGED_EVENT_TYPE]: "role_permissions_changed",
  [ROLE_DELETED_EVENT_TYPE]: "role_deleted",
};

const logger = createLogger("langwatch:authz:audit-trail");

/** Every fact these sources author is backdated history that already
 *  happened somewhere else — the legacy tables, an earlier backfill, or a
 *  key the resolver minted on read. Auditing them would fill the customer's
 *  audit page with thousands of rows for changes nobody made. */
const NON_AUDITABLE_SOURCES: readonly GrantEventSource[] = [
  "migration",
  "read-through-mint",
];

/** The audit row, in the existing `AuditLog` shape. The store never sees a
 *  Prisma type: the pipeline stays storage-free. */
export interface AuthzAuditRow {
  id: string;
  createdAt: Date;
  userId: string | null;
  organizationId: string;
  action: string;
  metadata: Record<string, unknown>;
}

/** Insert-only, ON CONFLICT DO NOTHING. There is no update: an audit row is
 *  a fact about a moment, and a re-delivered event describes the same one. */
export interface AuthzAuditTrailStore {
  insert(row: AuthzAuditRow): Promise<void>;
}

export interface AuthzAuditTrailSubscriberDeps {
  store: AuthzAuditTrailStore;
}

function guardFields(event: AuthzGrantsEvent): {
  source?: string;
  actor?: { type: string; id: string | null };
} {
  return event.data as {
    source?: string;
    actor?: { type: string; id: string | null };
  };
}

/**
 * Pure relevance guard (ADR-092 decision 17), shared by `when` — so a
 * cutover import never even stages a job — and re-checked in the handler,
 * because `when` fails open by contract (ADR-026, carried by ADR-098) and
 * "fail open" here would mean flooding the audit page.
 */
export function isAuditableGrantEvent(event: AuthzGrantsEvent): boolean {
  const { source, actor } = guardFields(event);
  // `source` arrives as the wire event's plain string field, wider than the
  // union the array is pinned to on purpose (see the type above) - the cast
  // is on this comparison, not on the declaration a rename must still catch.
  if (
    source !== undefined &&
    (NON_AUDITABLE_SOURCES as readonly string[]).includes(source)
  ) {
    return false;
  }
  // Role events carry no `source`, so the migration's backdated role facts
  // are recognised by the only actor that authors them.
  if (actor?.type === "system" && actor.id === SYSTEM_ACTORS.migrationRunner) {
    return false;
  }
  return true;
}

/**
 * The payload fields each event family puts in the audit row — an ALLOW-list,
 * per family.
 *
 * It used to be a deny-list of one (`actor`), which meant every field a future
 * event gains is published to the customer's audit page by default. The
 * resource tier's `token` is the case that makes this non-negotiable: it IS a
 * credential, it lives on `grant_attached`, and a deny-list would have copied
 * it into an `AuditLog` row the moment a share link became a grant. Naming the
 * fields is what makes adding one a decision instead of an accident.
 *
 * The actor is still absent from every list: it is already the row's own
 * `userId` column, and repeating it invites the two to disagree.
 */
const AUDIT_METADATA_FIELDS: Record<AuditableEventType, readonly string[]> = {
  [GRANT_ATTACHED_EVENT_TYPE]: [
    "grantId",
    "principal",
    "roleKey",
    "scope",
    "source",
    "legacyRole",
  ],
  [GRANT_ROLE_CHANGED_EVENT_TYPE]: ["grantId", "from", "to"],
  [GRANT_REVOKED_EVENT_TYPE]: ["grantId", "selector", "reason"],
  [ROLE_DEFINED_EVENT_TYPE]: [
    "roleId",
    "name",
    "description",
    "permissions",
    "kind",
  ],
  [ROLE_PERMISSIONS_CHANGED_EVENT_TYPE]: ["roleId", "permissions"],
  [ROLE_DELETED_EVENT_TYPE]: ["roleId"],
};

/** The named fields this event actually carries. An absent optional field
 *  stays absent rather than becoming an explicit null. */
function auditMetadata(event: AuthzGrantsEvent): Record<string, unknown> {
  const data = event.data as Record<string, unknown>;
  const metadata: Record<string, unknown> = {};
  for (const field of AUDIT_METADATA_FIELDS[event.type as AuditableEventType] ??
    []) {
    if (data[field] !== undefined) metadata[field] = data[field];
  }
  return metadata;
}

/**
 * An event type this subscriber subscribed to and cannot name.
 *
 * Unreachable while `AUDIT_VERB_BY_EVENT_TYPE` and `AUTHZ_AUDIT_EVENT_TYPES`
 * agree — the Record's key type is the tuple, so a subscribed type with no
 * verb fails `pnpm typecheck`, and a test enumerates the schema union so a NEW
 * event type fails a test rather than the audit page. It throws anyway,
 * because the alternative it replaces wrote `authz.grants.undefined` into the
 * customer's audit trail and reported success: a row nobody can query, in a
 * table nobody re-derives, discovered months later. Throwing hands the job
 * back to the queue, which retries and then parks it where it can be seen.
 */
class UnmappedAuthzAuditEventError extends Error {
  constructor(type: string) {
    super(`no audit verb is mapped for the authz grants event ${type}`);
    this.name = "UnmappedAuthzAuditEventError";
  }
}

/** Derived from the event id, which is what makes a re-delivery a no-op:
 *  the second insert collides with the first and is dropped. */
export function authzAuditRowId(eventId: string): string {
  return `authz-evt-${eventId}`;
}

export function toAuthzAuditRow(event: AuthzGrantsEvent): AuthzAuditRow {
  const { actor } = guardFields(event);
  const verb = AUDIT_VERB_BY_EVENT_TYPE[event.type as AuditableEventType];
  if (verb === undefined) {
    logger.error(
      { eventType: event.type, eventId: event.id },
      "the authz audit trail has no verb for an event it subscribes to; no row was written",
    );
    throw new UnmappedAuthzAuditEventError(event.type);
  }
  return {
    id: authzAuditRowId(event.id),
    // Business time, not ledger-accepted time: the row says when access
    // actually changed.
    createdAt: new Date(event.occurredAt),
    userId: actor?.type === "user" ? actor.id : null,
    // One aggregate per organization (ADR-092 §13).
    organizationId: event.aggregateId,
    action: `${AUTHZ_AUDIT_ACTION_PREFIX}${verb}`,
    metadata: auditMetadata(event),
  };
}

/**
 * The audit trail as an insert-only subscriber (ADR-092 decision 17), not a
 * projection: the grant write paths stop writing `AuditLog` themselves and
 * the ledger's own events become the trail. Subscribers are excluded from
 * replay (ADR-098), so a projection rebuild cannot touch these rows, and the
 * deterministic id makes the one path that CAN re-deliver — a retried job —
 * a no-op.
 *
 * A failed insert throws, so the queue retries it. The insert is idempotent,
 * so the retry costs nothing, and a missing audit row is worse than a
 * repeated attempt.
 */
export function createAuthzAuditTrailSubscriber(
  deps: AuthzAuditTrailSubscriberDeps,
): SubscriberSpec<AuthzGrantsEvent> {
  return {
    events: AUTHZ_AUDIT_EVENT_TYPES,
    when: (event) => isAuditableGrantEvent(event),
    async handler(event: AuthzGrantsEvent): Promise<void> {
      if (!isAuditableGrantEvent(event)) return;
      await deps.store.insert(toAuthzAuditRow(event));
    },
  };
}

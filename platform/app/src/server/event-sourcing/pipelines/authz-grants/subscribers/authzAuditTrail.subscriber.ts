import type { SubscriberSpec } from "../../../pipeline/processManagerDefinition";
import {
  GRANT_ATTACHED_EVENT_TYPE,
  GRANT_REVOKED_EVENT_TYPE,
  GRANT_ROLE_CHANGED_EVENT_TYPE,
  MEMBER_OFFBOARDED_EVENT_TYPE,
  ROLE_DEFINED_EVENT_TYPE,
  ROLE_DELETED_EVENT_TYPE,
  ROLE_PERMISSIONS_CHANGED_EVENT_TYPE,
} from "../schemas/constants";
import type { AuthzGrantsEvent } from "../schemas/events";

/** The runtime family only: the process family records the cutover
 *  machine's own moves, which are an operator concern, not an access fact
 *  a customer's audit page should carry. */
export const AUTHZ_AUDIT_EVENT_TYPES = [
  GRANT_ATTACHED_EVENT_TYPE,
  GRANT_ROLE_CHANGED_EVENT_TYPE,
  GRANT_REVOKED_EVENT_TYPE,
  ROLE_DEFINED_EVENT_TYPE,
  ROLE_PERMISSIONS_CHANGED_EVENT_TYPE,
  ROLE_DELETED_EVENT_TYPE,
  MEMBER_OFFBOARDED_EVENT_TYPE,
] as const;

type AuditableEventType = (typeof AUTHZ_AUDIT_EVENT_TYPES)[number];

/** Stable verbs. The event type is a wire name that may gain a version
 *  suffix; the audit `action` is a customer-facing string that must not
 *  move once a row carries it. */
const AUDIT_VERB_BY_EVENT_TYPE: Record<AuditableEventType, string> = {
  [GRANT_ATTACHED_EVENT_TYPE]: "attach",
  [GRANT_ROLE_CHANGED_EVENT_TYPE]: "role_change",
  [GRANT_REVOKED_EVENT_TYPE]: "revoke",
  [ROLE_DEFINED_EVENT_TYPE]: "role_defined",
  [ROLE_PERMISSIONS_CHANGED_EVENT_TYPE]: "role_permissions_changed",
  [ROLE_DELETED_EVENT_TYPE]: "role_deleted",
  [MEMBER_OFFBOARDED_EVENT_TYPE]: "offboard",
};

export const AUTHZ_AUDIT_ACTION_PREFIX = "authz.grants." as const;

/** Every fact these sources author is backdated history that already
 *  happened somewhere else — the legacy tables, an earlier backfill, or a
 *  key the resolver minted on read. Auditing them would fill the customer's
 *  audit page with thousands of rows for changes nobody made. */
const NON_AUDITABLE_SOURCES: readonly string[] = [
  "genesis-import",
  "backfill-b",
  "read-through-mint",
];

/** Role events carry no `source`, so the genesis import's role facts are
 *  recognised by the only actor that authors them. */
const GENESIS_ACTOR_ID = "system:genesis-import";

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
  if (source !== undefined && NON_AUDITABLE_SOURCES.includes(source)) {
    return false;
  }
  if (actor?.type === "system" && actor.id === GENESIS_ACTOR_ID) {
    return false;
  }
  return true;
}

/** Everything on the event except who did it — the actor is already spread
 *  across the row's own `userId` column, and repeating it in the payload
 *  invites the two to disagree. */
function auditMetadata(event: AuthzGrantsEvent): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(
    event.data as Record<string, unknown>,
  )) {
    if (key === "actor") continue;
    metadata[key] = value;
  }
  return metadata;
}

/** Derived from the event id, which is what makes a re-delivery a no-op:
 *  the second insert collides with the first and is dropped. */
export function authzAuditRowId(eventId: string): string {
  return `authz-evt-${eventId}`;
}

export function toAuthzAuditRow(event: AuthzGrantsEvent): AuthzAuditRow {
  const { actor } = guardFields(event);
  const verb = AUDIT_VERB_BY_EVENT_TYPE[event.type as AuditableEventType];
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

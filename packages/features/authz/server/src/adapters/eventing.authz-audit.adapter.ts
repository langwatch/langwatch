import { SYSTEM_ACTORS } from "@langwatch/actor";
import {
  GRANT_ATTACHED_EVENT_TYPE,
  GRANT_REVOKED_EVENT_TYPE,
  GRANT_ROLE_CHANGED_EVENT_TYPE,
  ROLE_DEFINED_EVENT_TYPE,
  ROLE_DELETED_EVENT_TYPE,
  ROLE_PERMISSIONS_CHANGED_EVENT_TYPE,
} from "@langwatch/authz-contract";
import type { TriggerContext } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import type { AuthzGrantsEvent } from "./eventing.authz.adapter";

export const AUTHZ_AUDIT_ACTION_PREFIX = "authz.grants." as const;
export const AUTHZ_AUDIT_VERBS = [
  "attach",
  "role_change",
  "revoke",
  "role_defined",
  "role_permissions_changed",
  "role_deleted",
] as const;
export type AuthzAuditVerb = (typeof AUTHZ_AUDIT_VERBS)[number];

export const AUTHZ_AUDIT_EVENT_TYPES = [
  GRANT_ATTACHED_EVENT_TYPE,
  GRANT_ROLE_CHANGED_EVENT_TYPE,
  GRANT_REVOKED_EVENT_TYPE,
  ROLE_DEFINED_EVENT_TYPE,
  ROLE_PERMISSIONS_CHANGED_EVENT_TYPE,
  ROLE_DELETED_EVENT_TYPE,
] as const;

export const AUTHZ_NON_AUDIT_EVENT_TYPES = [] as const;

type AuditableEventType = (typeof AUTHZ_AUDIT_EVENT_TYPES)[number];

const AUDIT_VERB_BY_EVENT_TYPE: Record<AuditableEventType, AuthzAuditVerb> = {
  [GRANT_ATTACHED_EVENT_TYPE]: "attach",
  [GRANT_ROLE_CHANGED_EVENT_TYPE]: "role_change",
  [GRANT_REVOKED_EVENT_TYPE]: "revoke",
  [ROLE_DEFINED_EVENT_TYPE]: "role_defined",
  [ROLE_PERMISSIONS_CHANGED_EVENT_TYPE]: "role_permissions_changed",
  [ROLE_DELETED_EVENT_TYPE]: "role_deleted",
};

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
  [ROLE_DEFINED_EVENT_TYPE]: ["roleId", "name", "description", "permissions", "kind"],
  [ROLE_PERMISSIONS_CHANGED_EVENT_TYPE]: ["roleId", "permissions"],
  [ROLE_DELETED_EVENT_TYPE]: ["roleId"],
};

const NON_AUDITABLE_SOURCES = ["migration", "read-through-mint"] as const;
const AUTHZ_ENGINE_MIGRATION_ACTOR_ID = "system:authz-engine" as const;
const NON_AUDITABLE_ACTOR_IDS = new Set<string>([
  SYSTEM_ACTORS.migrationRunner,
  AUTHZ_ENGINE_MIGRATION_ACTOR_ID,
]);
const logger = createLogger("langwatch:authz:audit-trail");

export interface AuthzAuditRow {
  id: string;
  createdAt: Date;
  userId: string | null;
  organizationId: string;
  action: string;
  metadata: Record<string, unknown>;
}

/** Insert is idempotent by row ID and never updates an existing audit fact. */
export abstract class AuthzAuditTrailStore {
  abstract insert(row: AuthzAuditRow): Promise<void>;
}

class UnmappedAuthzAuditEventError extends Error {
  constructor(type: string) {
    super(`no audit verb is mapped for the authz grants event ${type}`);
    this.name = "UnmappedAuthzAuditEventError";
  }
}

class AuthzAuditRowMapper {
  static isAuditable(event: AuthzGrantsEvent): boolean {
    const { source, actor } = this.guardFields(event);
    if (
      source !== undefined &&
      (NON_AUDITABLE_SOURCES as readonly string[]).includes(source)
    ) {
      return false;
    }
    if (
      actor?.type === "system" &&
      actor.id !== null &&
      NON_AUDITABLE_ACTOR_IDS.has(actor.id)
    ) {
      return false;
    }
    return true;
  }

  static rowId(eventId: string): string {
    return `authz-evt-${eventId}`;
  }

  static toRow(event: AuthzGrantsEvent): AuthzAuditRow {
    const { actor } = this.guardFields(event);
    const verb = AUDIT_VERB_BY_EVENT_TYPE[event.type];
    if (verb === undefined) {
      logger.error(
        { eventType: event.type, eventId: event.id },
        "the authz audit trail has no verb for an event it subscribes to; no row was written",
      );
      throw new UnmappedAuthzAuditEventError(event.type);
    }
    return {
      id: this.rowId(event.id),
      createdAt: new Date(event.occurredAt),
      userId: actor?.type === "user" ? actor.id : null,
      organizationId: event.tenantId,
      action: `${AUTHZ_AUDIT_ACTION_PREFIX}${verb}`,
      metadata: this.metadata(event),
    };
  }

  private static guardFields(event: AuthzGrantsEvent): {
    source?: string;
    actor?: { type: string; id: string | null };
  } {
    return event.data as {
      source?: string;
      actor?: { type: string; id: string | null };
    };
  }

  private static metadata(event: AuthzGrantsEvent): Record<string, unknown> {
    const data = event.data as unknown as Record<string, unknown>;
    const metadata: Record<string, unknown> = {};
    for (const field of AUDIT_METADATA_FIELDS[event.type] ?? []) {
      if (data[field] !== undefined) metadata[field] = data[field];
    }
    return metadata;
  }
}

export interface EventingAuthzAuditAdapterOptions {
  store: AuthzAuditTrailStore;
}

/** Class-backed Eventing subscriber; replay never invokes event subscribers. */
export class EventingAuthzAuditAdapter {
  readonly events = AUTHZ_AUDIT_EVENT_TYPES;

  private constructor(private readonly store: AuthzAuditTrailStore) {}

  static create(options: EventingAuthzAuditAdapterOptions): EventingAuthzAuditAdapter {
    return new EventingAuthzAuditAdapter(options.store);
  }

  when(event: AuthzGrantsEvent): boolean {
    return AuthzAuditRowMapper.isAuditable(event);
  }

  async handler(
    event: AuthzGrantsEvent,
    _context?: TriggerContext<unknown>,
  ): Promise<void> {
    if (!AuthzAuditRowMapper.isAuditable(event)) return;
    await this.store.insert(AuthzAuditRowMapper.toRow(event));
  }
}

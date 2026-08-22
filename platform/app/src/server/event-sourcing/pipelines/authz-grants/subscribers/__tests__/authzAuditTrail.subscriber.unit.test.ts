import { describe, expect, it } from "vitest";
import { createTenantId } from "../../../..";
import {
  AUTHZ_GRANT_AGGREGATE_TYPE,
  AUTHZ_GRANTS_EVENT_VERSION_LATEST,
  GRANT_ATTACHED_EVENT_TYPE,
  GRANT_REVOKED_EVENT_TYPE,
  GRANT_ROLE_CHANGED_EVENT_TYPE,
  ROLE_DEFINED_EVENT_TYPE,
  ROLE_DELETED_EVENT_TYPE,
  ROLE_PERMISSIONS_CHANGED_EVENT_TYPE,
} from "../../schemas/constants";
import {
  type AuthzGrantsEvent,
  authzGrantsEventSchema,
} from "../../schemas/events";
import {
  AUTHZ_AUDIT_EVENT_TYPES,
  AUTHZ_NON_AUDIT_EVENT_TYPES,
  type AuthzAuditRow,
  type AuthzAuditTrailStore,
  createAuthzAuditTrailSubscriber,
} from "../authzAuditTrail.subscriber";

const ORG = "org_acme";
const OCCURRED_AT = 1_700_000_000_000;
const USER_ACTOR = { type: "user" as const, id: "user_admin" };
const MIGRATION_ACTOR = {
  type: "system" as const,
  id: "system:migration-runner",
};

function event(
  type: string,
  data: Record<string, unknown>,
  overrides?: { id?: string; occurredAt?: number },
): AuthzGrantsEvent {
  return {
    id: overrides?.id ?? "evt_2Zk",
    // A grant's aggregate is the grant, never the organization (ADR-110):
    // the row's organizationId must come from the tenant.
    aggregateId: "grant_1",
    aggregateType: AUTHZ_GRANT_AGGREGATE_TYPE,
    tenantId: createTenantId(ORG),
    createdAt: 1_800_000_000_000,
    occurredAt: overrides?.occurredAt ?? OCCURRED_AT,
    type,
    version: AUTHZ_GRANTS_EVENT_VERSION_LATEST,
    data,
  } as unknown as AuthzGrantsEvent;
}

function attached(overrides?: Record<string, unknown>): AuthzGrantsEvent {
  return event(GRANT_ATTACHED_EVENT_TYPE, {
    grantId: "grant_1",
    principal: { type: "user", id: "user_alice" },
    roleKey: "member",
    scope: { type: "TEAM", id: "team_client_a" },
    source: "grants-service",
    actor: USER_ACTOR,
    ...overrides,
  });
}

/** Records every insert, and mimics the store's ON CONFLICT DO NOTHING so a
 *  repeated delivery is observable as "the table did not change". */
function recordingStore(): AuthzAuditTrailStore & {
  inserts: AuthzAuditRow[];
  rows: Map<string, AuthzAuditRow>;
} {
  const inserts: AuthzAuditRow[] = [];
  const rows = new Map<string, AuthzAuditRow>();
  return {
    inserts,
    rows,
    async insert(row) {
      inserts.push(row);
      if (!rows.has(row.id)) rows.set(row.id, row);
    },
  };
}

function deliver(
  store: AuthzAuditTrailStore,
  authzEvent: AuthzGrantsEvent,
): Promise<void> {
  const subscriber = createAuthzAuditTrailSubscriber({ store });
  return subscriber.handler(authzEvent, {
    tenantId: ORG,
    aggregateId: ORG,
    state: undefined,
  });
}

describe("authz audit trail subscriber", () => {
  describe("when registered", () => {
    it("listens to the runtime family only", () => {
      expect([...AUTHZ_AUDIT_EVENT_TYPES]).toEqual([
        GRANT_ATTACHED_EVENT_TYPE,
        GRANT_ROLE_CHANGED_EVENT_TYPE,
        GRANT_REVOKED_EVENT_TYPE,
        ROLE_DEFINED_EVENT_TYPE,
        ROLE_PERMISSIONS_CHANGED_EVENT_TYPE,
        ROLE_DELETED_EVENT_TYPE,
      ]);
    });
  });

  describe("when a grant is attached by a person", () => {
    /** @scenario "A grant a person made is recorded in the audit trail" */
    it("writes one row in the AuditLog shape", async () => {
      const store = recordingStore();
      await deliver(store, attached());

      expect(store.inserts).toHaveLength(1);
      expect(store.inserts[0]).toEqual({
        id: "authz-evt-evt_2Zk",
        createdAt: new Date(OCCURRED_AT),
        userId: "user_admin",
        organizationId: ORG,
        action: "authz.grants.attach",
        metadata: {
          grantId: "grant_1",
          principal: { type: "user", id: "user_alice" },
          roleKey: "member",
          scope: { type: "TEAM", id: "team_client_a" },
          source: "grants-service",
        },
      });
    });

    it("keeps the actor out of the metadata, since the row already names them", async () => {
      const store = recordingStore();
      await deliver(store, attached());

      expect(store.inserts[0]!.metadata).not.toHaveProperty("actor");
    });
  });

  describe("when the actor is a system principal", () => {
    it("leaves userId null rather than inventing a person", async () => {
      const store = recordingStore();
      await deliver(
        store,
        attached({
          source: "scim",
          actor: { type: "system", id: "system:scim" },
        }),
      );

      expect(store.inserts[0]!.userId).toBeNull();
      expect(store.inserts[0]!.organizationId).toBe(ORG);
    });
  });

  describe("when the event carries a backdated source", () => {
    /** @scenario "Facts stated by the platform itself never reach the audit trail" */
    it.each([
      "migration",
      "read-through-mint",
    ])("writes no row for %s", async (source) => {
      const store = recordingStore();
      await deliver(store, attached({ source }));

      expect(store.inserts).toHaveLength(0);
    });

    /** @scenario "Facts stated by the platform itself never reach the audit trail" */
    it("still writes a row for a live source", async () => {
      const store = recordingStore();
      await deliver(store, attached({ source: "invite" }));

      expect(store.inserts).toHaveLength(1);
    });
  });

  describe("when a role event carries no source", () => {
    it("skips the migration, recognised by its actor", async () => {
      const store = recordingStore();
      await deliver(
        store,
        event(ROLE_DEFINED_EVENT_TYPE, {
          roleId: "role_1",
          name: "Auditor",
          permissions: ["traces.read"],
          kind: "custom",
          actor: MIGRATION_ACTOR,
        }),
      );

      expect(store.inserts).toHaveLength(0);
    });

    it("records a role a person defined", async () => {
      const store = recordingStore();
      await deliver(
        store,
        event(ROLE_DEFINED_EVENT_TYPE, {
          roleId: "role_1",
          name: "Auditor",
          permissions: ["traces.read"],
          kind: "custom",
          actor: USER_ACTOR,
        }),
      );

      expect(store.inserts[0]!.action).toBe("authz.grants.role_defined");
      expect(store.inserts[0]!.metadata).toEqual({
        roleId: "role_1",
        name: "Auditor",
        permissions: ["traces.read"],
        kind: "custom",
      });
    });
  });

  describe("when each runtime event type arrives", () => {
    it.each([
      [GRANT_ATTACHED_EVENT_TYPE, "authz.grants.attach"],
      [GRANT_ROLE_CHANGED_EVENT_TYPE, "authz.grants.role_change"],
      [GRANT_REVOKED_EVENT_TYPE, "authz.grants.revoke"],
      [ROLE_DEFINED_EVENT_TYPE, "authz.grants.role_defined"],
      [
        ROLE_PERMISSIONS_CHANGED_EVENT_TYPE,
        "authz.grants.role_permissions_changed",
      ],
      [ROLE_DELETED_EVENT_TYPE, "authz.grants.role_deleted"],
    ])("maps %s onto the stable verb %s", async (type, action) => {
      const store = recordingStore();
      await deliver(store, event(type, { actor: USER_ACTOR }));

      expect(store.inserts[0]!.action).toBe(action);
    });
  });

  describe("when the same event is delivered twice", () => {
    /** @scenario "A fact delivered twice writes one audit row" */
    it("derives the same row id, so the second insert is dropped", async () => {
      const store = recordingStore();
      const redelivered = attached();
      await deliver(store, redelivered);
      await deliver(store, redelivered);

      expect(store.inserts).toHaveLength(2);
      expect(store.inserts[0]).toEqual(store.inserts[1]);
      expect(store.rows.size).toBe(1);
    });

    it("keys the id off the event id, so two events never collide", async () => {
      const store = recordingStore();
      await deliver(store, attached());
      await deliver(
        store,
        event(
          GRANT_ATTACHED_EVENT_TYPE,
          { grantId: "grant_2", source: "invite", actor: USER_ACTOR },
          { id: "evt_2Zl", occurredAt: OCCURRED_AT + 1_000 },
        ),
      );

      expect([...store.rows.keys()]).toEqual([
        "authz-evt-evt_2Zk",
        "authz-evt-evt_2Zl",
      ]);
    });
  });

  describe("when the wire union gains an event type", () => {
    /** The two lists are the whole aggregate, split. A new member of the
     *  union belongs to one of them by a decision someone made, and this is
     *  where an undecided one is caught — rather than on a customer's audit
     *  page, as `authz.grants.undefined`. */
    it("covers every event type exactly once, audited or deliberately not", () => {
      const unionTypes = authzGrantsEventSchema.options
        .map((option) => option.shape.type.value as string)
        .sort();
      const classified = [
        ...AUTHZ_AUDIT_EVENT_TYPES,
        ...AUTHZ_NON_AUDIT_EVENT_TYPES,
      ].sort();

      expect(classified).toEqual(unionTypes);
      expect(new Set(classified).size).toBe(classified.length);
    });
  });

  describe("when an event type carries no audit verb", () => {
    it("writes no row and fails loudly", async () => {
      const store = recordingStore();

      // A type outside the verb map on purpose: every type the family
      // currently publishes IS audited, so the only way to reach this guard
      // is to hand it the shape a future unmapped event would have.
      await expect(
        deliver(store, event("authz.grants.unmapped", { actor: USER_ACTOR })),
      ).rejects.toThrow(/no audit verb/);
      expect(store.inserts).toHaveLength(0);
    });
  });

  describe("when the event carries a field the audit row does not name", () => {
    /** A deny-list published every future field by default; the resource
     *  tier's `token` IS a credential and rides `grant_attached`. */
    it("copies only the named fields into the metadata", async () => {
      const store = recordingStore();
      await deliver(
        store,
        attached({
          resource: { token: "tok_secret", permission: "traces:view" },
          somethingNew: "should not travel",
        }),
      );

      expect(store.inserts[0]!.metadata).toEqual({
        grantId: "grant_1",
        principal: { type: "user", id: "user_alice" },
        roleKey: "member",
        scope: { type: "TEAM", id: "team_client_a" },
        source: "grants-service",
      });
    });
  });

  describe("when the pre-enqueue guard runs", () => {
    it("agrees with the handler, so a skipped event never stages a job", () => {
      const store = recordingStore();
      const subscriber = createAuthzAuditTrailSubscriber({ store });
      const context = { tenantId: ORG, aggregateId: ORG, state: undefined };

      expect(
        subscriber.when?.(attached({ source: "migration" }), context),
      ).toBe(false);
      expect(
        subscriber.when?.(attached({ source: "read-through-mint" }), context),
      ).toBe(false);
      expect(subscriber.when?.(attached(), context)).toBe(true);
    });
  });
});

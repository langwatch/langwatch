import { SYSTEM_ACTORS } from "@langwatch/actor";
import { GRANT_EVENT_SOURCES } from "@langwatch/authz-server";
import { describe, expect, it } from "vitest";
import { createTenantId } from "../../../..";
import {
  AUTHZ_GRANT_AGGREGATE_TYPE,
  AUTHZ_GRANTS_EVENT_VERSION_LATEST,
  GRANT_ATTACHED_EVENT_TYPE,
  GRANT_REVOKED_EVENT_TYPE,
  GRANT_ROLE_CHANGED_EVENT_TYPE,
  GROUP_MEMBER_ADDED_EVENT_TYPE,
  GROUP_MEMBER_REMOVED_EVENT_TYPE,
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
  NON_AUDITABLE_SOURCES,
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
  overrides?: { id?: string; occurredAt?: number; aggregateId?: string },
): AuthzGrantsEvent {
  return {
    id: overrides?.id ?? "evt_2Zk",
    // The GRANT, not the organization (ADR-110). The fixture used to stamp
    // the organization here, left over from the model where the org WAS the
    // aggregate — which made the row's `organizationId` assertion below pass
    // no matter which field the subscriber read it from, and hid that it was
    // reading `aggregateId`. Every real event carries an entity id here.
    aggregateId: overrides?.aggregateId ?? "grant_1",
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

const MEMBERSHIP_AGGREGATE = "group_sec_eng:user_dave";

function memberAdded(overrides?: Record<string, unknown>): AuthzGrantsEvent {
  return event(
    GROUP_MEMBER_ADDED_EVENT_TYPE,
    {
      membershipId: "groupmember_1",
      groupId: "group_sec_eng",
      userId: "user_dave",
      source: "grants-service",
      actor: USER_ACTOR,
      ...overrides,
    },
    { aggregateId: MEMBERSHIP_AGGREGATE },
  );
}

function memberRemoved(overrides?: Record<string, unknown>): AuthzGrantsEvent {
  return event(
    GROUP_MEMBER_REMOVED_EVENT_TYPE,
    {
      membershipId: "groupmember_1",
      groupId: "group_sec_eng",
      userId: "user_dave",
      reason: "removed from group",
      actor: USER_ACTOR,
      ...overrides,
    },
    { aggregateId: MEMBERSHIP_AGGREGATE },
  );
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
    aggregateId: authzEvent.aggregateId,
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
        GROUP_MEMBER_ADDED_EVENT_TYPE,
        GROUP_MEMBER_REMOVED_EVENT_TYPE,
      ]);
    });
  });

  describe("when a membership change is delivered", () => {
    /** @scenario "The change appears in the authz change history" */
    it("files the row under the organization, never under the aggregate", async () => {
      const store = recordingStore();
      await deliver(store, memberRemoved());

      // The aggregate is the pair, so reading `aggregateId` here would file
      // every membership change under "group_sec_eng:user_dave" — a value the
      // audit page, which queries by organization, can never find.
      expect(store.inserts[0]!.organizationId).toBe(ORG);
    });

    /** @scenario "The change appears in the authz change history" */
    it("names the person, the group and who made the change", async () => {
      const store = recordingStore();
      await deliver(store, memberRemoved());

      expect(store.inserts[0]).toMatchObject({
        action: "authz.grants.group_member_removed",
        userId: "user_admin",
        metadata: {
          membershipId: "groupmember_1",
          groupId: "group_sec_eng",
          userId: "user_dave",
          reason: "removed from group",
        },
      });
    });

    it("records an addition under its own verb", async () => {
      const store = recordingStore();
      await deliver(store, memberAdded());

      expect(store.inserts[0]).toMatchObject({
        action: "authz.grants.group_member_added",
        metadata: {
          membershipId: "groupmember_1",
          groupId: "group_sec_eng",
          userId: "user_dave",
          source: "grants-service",
        },
      });
    });

    /** @scenario "A directory removing somebody is still a change somebody made" */
    it("records a directory's own change, with no person to attribute it to", async () => {
      const store = recordingStore();
      await deliver(
        store,
        memberAdded({
          source: "scim",
          actor: { type: "system", id: "system:scim" },
        }),
      );

      expect(store.inserts).toHaveLength(1);
      expect(store.inserts[0]).toMatchObject({
        userId: null,
        metadata: { source: "scim" },
      });
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

    /** Driven from the vocabulary rather than from a list of the sources
     *  that exist today: a source added to `GRANT_EVENT_SOURCES` and left
     *  out of the skip list is a change a customer made, and it audits by
     *  default. A new one that ought to be skipped has to say so.
     *  @scenario "A grant an automated surface made still reaches the audit trail" */
    it.each(
      GRANT_EVENT_SOURCES.filter(
        (source) => !NON_AUDITABLE_SOURCES.includes(source),
      ),
    )("still writes a row for %s", async (source) => {
      const store = recordingStore();
      await deliver(store, attached({ source }));

      expect(store.inserts).toHaveLength(1);
      expect(store.inserts[0]!.metadata).toMatchObject({ source });
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

  describe("when a surface rather than a person revokes a grant", () => {
    /** `grant_revoked` carries no `source`, so what makes a revocation
     *  attributable is its actor plus its reason. Only the migration runner
     *  is filtered by actor — a directory sync's de-enroll is a change the
     *  customer's own directory made, and it belongs on their audit page.
     *  @scenario "A revocation names the surface that made it without a source of its own" */
    it("records the row, with the reason and no invented person", async () => {
      const store = recordingStore();
      await deliver(
        store,
        event(GRANT_REVOKED_EVENT_TYPE, {
          grantId: "grant_1",
          reason: "offboarded:user_dave",
          actor: { type: "system", id: SYSTEM_ACTORS.scim },
        }),
      );

      expect(store.inserts).toHaveLength(1);
      expect(store.inserts[0]!.action).toBe("authz.grants.revoke");
      expect(store.inserts[0]!.userId).toBeNull();
      expect(store.inserts[0]!.metadata).toEqual({
        grantId: "grant_1",
        reason: "offboarded:user_dave",
      });
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

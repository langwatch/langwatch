import {
  AUTHZ_GRANTS_EVENT_VERSION_LATEST,
  GRANT_ATTACHED_EVENT_TYPE,
  ROLE_DEFINED_EVENT_TYPE,
} from "@langwatch/authz-contract";
import { createTenantId } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";
import {
  AuthzAuditTrailStore,
  type AuthzAuditRow,
  EventingAuthzAuditAdapter,
} from "../../src/adapters/eventing.authz-audit.adapter";
import type { AuthzGrantsEvent } from "../../src/adapters/eventing.authz.adapter";

const TENANT_ID = "org_acme";
const OCCURRED_AT = 1_700_000_000_000;
const USER_ACTOR = { type: "user" as const, id: "user_admin" };

class RecordingAuditTrailStore extends AuthzAuditTrailStore {
  readonly attempts: AuthzAuditRow[] = [];
  readonly rows = new Map<string, AuthzAuditRow>();

  async insert(row: AuthzAuditRow): Promise<void> {
    this.attempts.push(row);
    if (!this.rows.has(row.id)) this.rows.set(row.id, row);
  }
}

function event(
  type: string,
  aggregateId: string,
  data: Record<string, unknown>,
  id = "evt_2Zk",
): AuthzGrantsEvent {
  return {
    id,
    aggregateId,
    aggregateType: "authz_grant",
    tenantId: createTenantId(TENANT_ID),
    createdAt: OCCURRED_AT + 1_000,
    occurredAt: OCCURRED_AT,
    type,
    version: AUTHZ_GRANTS_EVENT_VERSION_LATEST,
    data,
  } as unknown as AuthzGrantsEvent;
}

function attached(overrides: Record<string, unknown> = {}): AuthzGrantsEvent {
  return event(GRANT_ATTACHED_EVENT_TYPE, "grant_1", {
    grantId: "grant_1",
    principal: { type: "user", id: "user_alice" },
    roleKey: "member",
    scope: { type: "TEAM", id: "team_1" },
    source: "grants-service",
    actor: USER_ACTOR,
    ...overrides,
  });
}

function roleDefined(
  actor: { type: "user" | "system"; id: string | null } = USER_ACTOR,
): AuthzGrantsEvent {
  return event(ROLE_DEFINED_EVENT_TYPE, "role_1", {
    roleId: "role_1",
    name: "Auditor",
    permissions: ["traces:view"],
    kind: "custom",
    actor,
  });
}

describe("EventingAuthzAuditAdapter", () => {
  it("redelivers with one event-derived row identity and one stored row", async () => {
    const store = new RecordingAuditTrailStore();
    const adapter = EventingAuthzAuditAdapter.create({ store });
    const redelivered = attached();

    await adapter.handler(redelivered);
    await adapter.handler(redelivered);

    expect(store.attempts).toHaveLength(2);
    expect(store.attempts[0]).toEqual(store.attempts[1]);
    expect(store.attempts[0]?.id).toBe("authz-evt-evt_2Zk");
    expect(store.rows.size).toBe(1);
  });

  it("uses tenantId for grant and role audit organizations", async () => {
    const store = new RecordingAuditTrailStore();
    const adapter = EventingAuthzAuditAdapter.create({ store });

    await adapter.handler(attached());
    await adapter.handler(roleDefined());

    expect(store.attempts.map(({ organizationId }) => organizationId)).toEqual([
      TENANT_ID,
      TENANT_ID,
    ]);
    expect(
      store.attempts.map(({ organizationId }) => organizationId),
    ).not.toContain("grant_1");
    expect(
      store.attempts.map(({ organizationId }) => organizationId),
    ).not.toContain("role_1");
  });

  it("skips imported grant sources and both migration role actors", async () => {
    const store = new RecordingAuditTrailStore();
    const adapter = EventingAuthzAuditAdapter.create({ store });

    for (const authzEvent of [
      attached({ source: "migration" }),
      attached({ source: "read-through-mint" }),
      roleDefined({ type: "system", id: "system:migration-runner" }),
      roleDefined({ type: "system", id: "system:authz-engine" }),
    ]) {
      expect(adapter.when(authzEvent)).toBe(false);
      await adapter.handler(authzEvent);
    }

    expect(store.attempts).toHaveLength(0);
  });

  it("allows only named metadata fields and never copies a resource token", async () => {
    const store = new RecordingAuditTrailStore();
    const adapter = EventingAuthzAuditAdapter.create({ store });

    await adapter.handler(
      attached({
        resource: {
          kind: "trace",
          projectId: "project_1",
          token: "secret-possession-token",
          permission: "traces:view",
        },
        somethingNew: "not-audited-by-default",
      }),
    );

    expect(store.attempts[0]?.metadata).toEqual({
      grantId: "grant_1",
      principal: { type: "user", id: "user_alice" },
      roleKey: "member",
      scope: { type: "TEAM", id: "team_1" },
      source: "grants-service",
    });
  });
});

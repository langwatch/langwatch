import { SYSTEM_ACTORS } from "@langwatch/actor";
import {
  AUTHZ_GRANTS_EVENT_VERSION_LATEST,
  GRANT_ATTACHED_EVENT_TYPE,
  GRANT_EVENT_SOURCES,
  GRANT_REVOKED_EVENT_TYPE,
  ROLE_DEFINED_EVENT_TYPE,
} from "@langwatch/authz-contract";
import { createTenantId } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";
import {
  AuthzAuditTrailStore,
  type AuthzAuditRow,
  EventingAuthzAuditAdapter,
} from "../eventing.authz-audit.adapter";
import type { AuthzGrantsEvent } from "../eventing.authz.adapter";

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
  /** @scenario "A grant a person made is recorded in the audit trail" */
  it("writes one row in the AuditLog shape", async () => {
    const store = new RecordingAuditTrailStore();
    const adapter = EventingAuthzAuditAdapter.create({ store });

    await adapter.handler(attached());

    expect(store.attempts).toHaveLength(1);
    expect(store.attempts[0]).toEqual({
      id: "authz-evt-evt_2Zk",
      createdAt: new Date(OCCURRED_AT),
      userId: "user_admin",
      organizationId: TENANT_ID,
      action: "authz.grants.attach",
      metadata: {
        grantId: "grant_1",
        principal: { type: "user", id: "user_alice" },
        roleKey: "member",
        scope: { type: "TEAM", id: "team_1" },
        source: "grants-service",
      },
    });
  });

  /**
   * Driven from the vocabulary rather than from a list of the sources that
   * exist today: a source added to `GRANT_EVENT_SOURCES` and left out of the
   * skip list is a change a customer made, and it audits by default. A new
   * one that ought to be skipped has to say so.
   * @scenario "A grant an automated surface made still reaches the audit trail"
   */
  it.each(
    GRANT_EVENT_SOURCES.filter(
      (source) => !["migration", "read-through-mint"].includes(source),
    ),
  )("still writes a row for %s", async (source) => {
    const store = new RecordingAuditTrailStore();
    const adapter = EventingAuthzAuditAdapter.create({ store });

    await adapter.handler(attached({ source }));

    expect(store.attempts).toHaveLength(1);
    expect(store.attempts[0]?.metadata).toMatchObject({ source });
  });

  /** @scenario "A fact delivered twice writes one audit row" */
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
    expect(store.attempts.map(({ organizationId }) => organizationId)).not.toContain("grant_1");
    expect(store.attempts.map(({ organizationId }) => organizationId)).not.toContain("role_1");
  });

  /** @scenario "Facts stated by the platform itself never reach the audit trail" */
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

  /** `grant_revoked` carries no `source`, so what makes a revocation
   *  attributable is its actor plus its reason. Only the migration runner
   *  is filtered by actor — a directory sync's de-enroll is a change the
   *  customer's own directory made, and it belongs on their audit page.
   *  @scenario "A revocation names the surface that made it without a source of its own" */
  it("records the row, with the reason and no invented person", async () => {
    const store = new RecordingAuditTrailStore();
    const adapter = EventingAuthzAuditAdapter.create({ store });

    await adapter.handler(
      event(GRANT_REVOKED_EVENT_TYPE, "grant_1", {
        grantId: "grant_1",
        reason: "offboarded:user_dave",
        actor: { type: "system", id: SYSTEM_ACTORS.scim },
      }),
    );

    expect(store.attempts).toHaveLength(1);
    expect(store.attempts[0]?.action).toBe("authz.grants.revoke");
    expect(store.attempts[0]?.userId).toBeNull();
    expect(store.attempts[0]?.metadata).toEqual({
      grantId: "grant_1",
      reason: "offboarded:user_dave",
    });
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

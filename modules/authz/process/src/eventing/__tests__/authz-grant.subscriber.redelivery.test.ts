import {
  AUTHZ_GRANTS_EVENT_VERSION_LATEST,
  GRANT_ATTACHED_EVENT_TYPE,
  ROLE_DEFINED_EVENT_TYPE,
  ROLE_DELETED_EVENT_TYPE,
} from "@langwatch/authz-contract";
import { createTenantId } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

import {
  AuthzAuditTrailRepository,
  type AuthzAuditRow,
} from "../../repositories/authz-audit-trail.repository.ts";
import {
  apiKeyGrantCommandId,
  AUTHZ_GRANT_AGGREGATE_TYPE,
  type GrantAttachedEvent,
  type RoleDefinedEvent,
  type RoleDeletedEvent,
} from "../authz-grant.events.ts";
import { EventingAuthzAuditAdapter } from "../authz-grant.subscriber.ts";

class KeyedAuditTrailStore extends AuthzAuditTrailRepository {
  readonly rows = new Map<string, AuthzAuditRow>();

  async insert(row: AuthzAuditRow): Promise<void> {
    if (!this.rows.has(row.id)) this.rows.set(row.id, row);
  }
}

const roleDeleted: RoleDeletedEvent = {
  id: "evt_role_deleted",
  aggregateId: "role_1",
  aggregateType: AUTHZ_GRANT_AGGREGATE_TYPE,
  tenantId: createTenantId("org_acme"),
  createdAt: 1_700_000_001_000,
  occurredAt: 1_700_000_000_000,
  type: ROLE_DELETED_EVENT_TYPE,
  version: AUTHZ_GRANTS_EVENT_VERSION_LATEST,
  data: { roleId: "role_1", actor: { type: "user", id: "user_admin" } },
};

const roleDefined: RoleDefinedEvent = {
  ...roleDeleted,
  id: "evt_role_defined",
  type: ROLE_DEFINED_EVENT_TYPE,
  idempotencyKey: "cmd_1:0",
  data: {
    roleId: "role_1",
    name: "apikey:key_1",
    permissions: ["traces:view"],
    kind: "system_api_key",
    actor: { type: "user", id: "user_admin" },
  },
};

const keyGrantAttached: GrantAttachedEvent = {
  ...roleDeleted,
  id: "evt_key_grant",
  aggregateId: "grant_1",
  type: GRANT_ATTACHED_EVENT_TYPE,
  idempotencyKey: `${apiKeyGrantCommandId("grant_1")}:0`,
  data: {
    grantId: "grant_1",
    principal: { type: "apiKey", id: "key_1" },
    roleKey: "custom:apikey:key_1",
    scope: { type: "PROJECT", id: "project_1" },
    source: "grants-service",
    onDuplicate: "skip",
    actor: { type: "user", id: "user_admin" },
  },
};

describe("EventingAuthzAuditAdapter redelivery", () => {
  it("leaves one audit row when the same fact is handled twice", async () => {
    const store = new KeyedAuditTrailStore();
    const adapter = EventingAuthzAuditAdapter.create({ store });

    await adapter.handler(roleDeleted);
    await adapter.handler(roleDeleted);

    expect([...store.rows.keys()]).toEqual(["authz-evt-evt_role_deleted"]);
  });

  /** @scenario "A role definition appended twice under one idempotency key writes one audit row" */
  it("leaves one audit row when one role definition is appended twice under new event ids", async () => {
    const store = new KeyedAuditTrailStore();
    const adapter = EventingAuthzAuditAdapter.create({ store });

    await adapter.handler({ ...roleDefined, id: "evt_first_append" });
    await adapter.handler({ ...roleDefined, id: "evt_second_append" });

    expect([...store.rows.keys()]).toEqual(["authz-evt-org_acme:role_1:cmd_1:0"]);
  });

  /** @scenario "A role definition appended twice under one idempotency key writes one audit row" */
  it("keeps a row for each role definition that shares a key across roles", async () => {
    const store = new KeyedAuditTrailStore();
    const adapter = EventingAuthzAuditAdapter.create({ store });

    await adapter.handler(roleDefined);
    await adapter.handler({ ...roleDefined, id: "evt_other", aggregateId: "role_2" });

    expect(store.rows.size).toBe(2);
  });

  /** @scenario "A role definition appended twice under one idempotency key writes one audit row" */
  it("keeps the event id as the row id for any other event, even one carrying a key", async () => {
    const store = new KeyedAuditTrailStore();
    const adapter = EventingAuthzAuditAdapter.create({ store });

    await adapter.handler({ ...roleDeleted, idempotencyKey: "cmd_1:0" });

    expect([...store.rows.keys()]).toEqual(["authz-evt-evt_role_deleted"]);
  });

  /** @scenario "A role definition appended twice under one idempotency key writes one audit row" */
  it("keeps the event id as the row id for a custom role's definition", async () => {
    const store = new KeyedAuditTrailStore();
    const adapter = EventingAuthzAuditAdapter.create({ store });
    const customRole = { ...roleDefined, data: { ...roleDefined.data, kind: "custom" as const } };

    await adapter.handler({ ...customRole, id: "evt_first_append" });
    await adapter.handler({ ...customRole, id: "evt_second_append" });

    expect([...store.rows.keys()]).toEqual([
      "authz-evt-evt_first_append",
      "authz-evt-evt_second_append",
    ]);
  });

  /** @scenario "An API key's own-role grant attached twice under one key writes one audit row" */
  it("leaves one audit row when an API key's own-role grant is appended twice", async () => {
    const store = new KeyedAuditTrailStore();
    const adapter = EventingAuthzAuditAdapter.create({ store });

    await adapter.handler({ ...keyGrantAttached, id: "evt_first_append" });
    await adapter.handler({ ...keyGrantAttached, id: "evt_second_append" });

    expect([...store.rows.keys()]).toEqual([
      "authz-evt-org_acme:grant_1:apikeygrant:grant_1:0",
    ]);
  });

  /** @scenario "An API key's own-role grant attached twice under one key writes one audit row" */
  it("keeps the event id as the row id for any other attach, even one carrying a key", async () => {
    const store = new KeyedAuditTrailStore();
    const adapter = EventingAuthzAuditAdapter.create({ store });

    await adapter.handler({ ...keyGrantAttached, idempotencyKey: "authzcmd_1:grant_1:0" });

    expect([...store.rows.keys()]).toEqual(["authz-evt-evt_key_grant"]);
  });
});

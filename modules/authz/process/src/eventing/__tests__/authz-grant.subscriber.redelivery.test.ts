import {
  API_KEY_OWN_GRANT_COMMAND_PREFIX,
  AUTHZ_GRANTS_EVENT_VERSION_LATEST,
  GRANT_ATTACHED_EVENT_TYPE,
  ROLE_DEFINED_EVENT_TYPE,
  ROLE_DELETED_EVENT_TYPE,
} from "@langwatch/authz-contract";
import { createTenantId } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

import {
  AUTHZ_GRANT_AGGREGATE_TYPE,
  type GrantAttachedEvent,
  type RoleDefinedEvent,
  type RoleDeletedEvent,
} from "../authz-grant.events.ts";
import { EventingAuthzAuditAdapter } from "../authz-grant.subscriber.ts";
import { KeyedAuditTrailStore } from "./support/authz-audit-trail.stub.ts";

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
  idempotencyKey: `${API_KEY_OWN_GRANT_COMMAND_PREFIX}key_1:content:0`,
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
  // The key's stable command id, then the binding id the adapter appends, then the event index.
  idempotencyKey: `${API_KEY_OWN_GRANT_COMMAND_PREFIX}key_1:content:grant_1:0`,
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

    expect([...store.rows.keys()]).toEqual([
      "authz-evt-org_acme:role_1:apikeygrant:key_1:content:0",
    ]);
  });

  /** @scenario "A role definition appended twice under one idempotency key writes one audit row" */
  it("keys and dates an edit of the key's role by its event, not its minted key", async () => {
    const store = new KeyedAuditTrailStore();
    const adapter = EventingAuthzAuditAdapter.create({ store });

    await adapter.handler({ ...roleDefined, idempotencyKey: "authzcmd_edit:0" });

    const [row] = [...store.rows.values()];
    expect(row?.id).toBe("authz-evt-evt_role_defined");
    expect(row?.createdAt.epochMilliseconds).toBe(roleDefined.occurredAt);
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
      "authz-evt-org_acme:grant_1:apikeygrant:key_1:content:grant_1:0",
    ]);
  });

  /** @scenario "A key's create audited under its fact is dated by its append" */
  it("dates a fact-keyed row by its append, and any other by its business time", async () => {
    const store = new KeyedAuditTrailStore();
    const adapter = EventingAuthzAuditAdapter.create({ store });
    // Stamped with the key's creation, then appended by a retry ten minutes later.
    const createdAt = 1_700_000_600_000;

    await adapter.handler({ ...keyGrantAttached, createdAt });
    await adapter.handler(roleDeleted);

    expect([...store.rows.values()].map((row) => row.createdAt.epochMilliseconds)).toEqual([
      createdAt,
      roleDeleted.occurredAt,
    ]);
  });

  /** @scenario "An API key's own-role grant attached twice under one key writes one audit row" */
  it("keeps the event id as the row id for any other attach, even one carrying a key", async () => {
    const store = new KeyedAuditTrailStore();
    const adapter = EventingAuthzAuditAdapter.create({ store });
    const userGrant = {
      ...keyGrantAttached,
      id: "evt_user_grant",
      data: { ...keyGrantAttached.data, principal: { type: "user" as const, id: "user_1" } },
    };

    await adapter.handler({ ...keyGrantAttached, idempotencyKey: "authzcmd_1:grant_1:0" });
    await adapter.handler(userGrant);

    expect([...store.rows.keys()]).toEqual(["authz-evt-evt_key_grant", "authz-evt-evt_user_grant"]);
  });
});

import {
  AUTHZ_GRANTS_EVENT_VERSION_LATEST,
  ROLE_DELETED_EVENT_TYPE,
} from "@langwatch/authz-contract";
import { createTenantId } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

import {
  AuthzAuditTrailRepository,
  type AuthzAuditRow,
} from "../../repositories/authz-audit-trail.repository.ts";
import { AUTHZ_GRANT_AGGREGATE_TYPE, type RoleDeletedEvent } from "../authz-grant.events.ts";
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

describe("EventingAuthzAuditAdapter redelivery", () => {
  it("leaves one audit row when the same fact is handled twice", async () => {
    const store = new KeyedAuditTrailStore();
    const adapter = EventingAuthzAuditAdapter.create({ store });

    await adapter.handler(roleDeleted);
    await adapter.handler(roleDeleted);

    expect([...store.rows.keys()]).toEqual(["authz-evt-evt_role_deleted"]);
  });
});

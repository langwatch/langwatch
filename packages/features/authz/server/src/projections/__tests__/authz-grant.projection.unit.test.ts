import {
  AUTHZ_GRANTS_EVENT_VERSION_LATEST,
  GRANT_ATTACHED_EVENT_TYPE,
  GRANT_REVOKED_EVENT_TYPE,
  GRANT_ROLE_CHANGED_EVENT_TYPE,
  ROLE_DEFINED_EVENT_TYPE,
  ROLE_DELETED_EVENT_TYPE,
  ROLE_PERMISSIONS_CHANGED_EVENT_TYPE,
} from "@langwatch/authz-contract";
import { createTenantId, type ProjectionStoreContext } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";
import type { AuthzGrantsEvent } from "../../adapters/eventing.authz.adapter";
import {
  AuthzGrantProjection,
  type GrantProjectionWrite,
  GrantProjectionWriteStore,
} from "../authz-grant.projection";

const TENANT_ID = "org_acme";
const ACTOR = { type: "user", id: "user_admin" } as const;

class NullGrantProjectionWriteStore extends GrantProjectionWriteStore {
  async append(_write: GrantProjectionWrite, _context: ProjectionStoreContext): Promise<void> {}
}

function event(
  type: string,
  data: Record<string, unknown>,
  aggregateId: string,
  occurredAt: number,
): AuthzGrantsEvent {
  return {
    id: `event_${occurredAt}`,
    aggregateId,
    aggregateType: "authz_grant",
    tenantId: createTenantId(TENANT_ID),
    createdAt: occurredAt,
    occurredAt,
    type,
    version: AUTHZ_GRANTS_EVENT_VERSION_LATEST,
    data,
  } as unknown as AuthzGrantsEvent;
}

const projection = AuthzGrantProjection.create(new NullGrantProjectionWriteStore());

describe("AuthzGrantProjection", () => {
  it("takes grant and role ownership from tenantId, never aggregateId", () => {
    const grant = projection.map(
      event(
        GRANT_ATTACHED_EVENT_TYPE,
        {
          grantId: "grant_1",
          principal: { type: "user", id: "user_1" },
          roleKey: "member",
          scope: { type: "TEAM", id: "team_1" },
          source: "grants-service",
          actor: ACTOR,
        },
        "grant_1",
        1,
      ),
    );
    const role = projection.map(
      event(
        ROLE_DEFINED_EVENT_TYPE,
        {
          roleId: "role_1",
          name: "Auditor",
          permissions: ["traces:view"],
          kind: "custom",
          actor: ACTOR,
        },
        "role_1",
        2,
      ),
    );

    expect(grant).toMatchObject({
      kind: "grant.upsert",
      row: { id: "grant_1", organizationId: TENANT_ID },
    });
    expect(role).toMatchObject({
      kind: "role.upsert",
      row: { id: "role_1", organizationId: TENANT_ID },
    });
  });

  it("maps every event to one deterministic state-setting write", () => {
    const writes = [
      projection.map(
        event(
          GRANT_ATTACHED_EVENT_TYPE,
          {
            grantId: "grant_1",
            principal: { type: "user", id: "user_1" },
            roleKey: "member",
            scope: { type: "TEAM", id: "team_1" },
            source: "grants-service",
            actor: ACTOR,
          },
          "grant_1",
          1,
        ),
      ),
      projection.map(
        event(
          GRANT_ROLE_CHANGED_EVENT_TYPE,
          {
            grantId: "grant_1",
            from: "member",
            to: "admin",
            actor: ACTOR,
          },
          "grant_1",
          2,
        ),
      ),
      projection.map(
        event(
          GRANT_REVOKED_EVENT_TYPE,
          { grantId: "grant_1", reason: "offboard", actor: ACTOR },
          "grant_1",
          3,
        ),
      ),
      projection.map(
        event(
          ROLE_DEFINED_EVENT_TYPE,
          {
            roleId: "role_1",
            name: "Auditor",
            permissions: ["traces:view"],
            kind: "custom",
            actor: ACTOR,
          },
          "role_1",
          4,
        ),
      ),
      projection.map(
        event(
          ROLE_PERMISSIONS_CHANGED_EVENT_TYPE,
          {
            roleId: "role_1",
            permissions: ["traces:view"],
            actor: ACTOR,
          },
          "role_1",
          5,
        ),
      ),
      projection.map(
        event(ROLE_DELETED_EVENT_TYPE, { roleId: "role_1", actor: ACTOR }, "role_1", 6),
      ),
    ];

    expect(writes.map(({ kind }) => kind)).toEqual([
      "grant.upsert",
      "grant.setRole",
      "grant.revoke",
      "role.upsert",
      "role.setPermissions",
      "role.delete",
    ]);
    expect(writes[1]).toEqual({
      kind: "grant.setRole",
      grantId: "grant_1",
      roleKey: "admin",
      occurredAt: new Date(2),
    });
  });
});

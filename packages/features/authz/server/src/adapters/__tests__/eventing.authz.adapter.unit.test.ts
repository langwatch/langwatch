import {
  AUTHZ_GRANTS_EVENT_TYPES,
  AUTHZ_GRANTS_EVENT_VERSION_LATEST,
} from "@langwatch/authz-contract";
import {
  type Command,
  createTenantId,
  type Event,
  type ProjectionStoreContext,
} from "@langwatch/eventing";
import { describe, expect, it } from "vitest";
import {
  AttachGrantCommand,
  AUTHZ_GRANT_AGGREGATE_TYPE,
  AUTHZ_GRANT_PIPELINE_NAME,
  ChangeGrantRoleCommand,
  ChangeRolePermissionsCommand,
  DefineRoleCommand,
  DeleteRoleCommand,
  EventingAuthzAdapter,
  RevokeGrantCommand,
} from "../eventing.authz.adapter";
import { AuthzAuditTrailStore, type AuthzAuditRow } from "../eventing.authz-audit.adapter";
import {
  type GrantProjectionWrite,
  GrantProjectionWriteStore,
} from "../../projections/authz-grant.projection";

const ORGANIZATION_ID = "org_acme";
const OCCURRED_AT = 1_755_000_000_000;
const ACTOR = { type: "user", id: "user_admin" } as const;
const IDENTITY = {
  tenantId: ORGANIZATION_ID,
  organizationId: ORGANIZATION_ID,
  commandId: "cmd_1",
} as const;
const GRANT = {
  grantId: "grant_1",
  principal: { type: "user", id: "user_alice" },
  roleKey: "member",
  scope: { type: "TEAM", id: "team_1" },
  source: "grants-service",
  actor: ACTOR,
  occurredAtMs: OCCURRED_AT,
} as const;
const ROLE = {
  roleId: "role_1",
  name: "Auditor",
  permissions: ["traces:view"],
  kind: "custom",
  occurredAtMs: OCCURRED_AT,
} as const;

class NullGrantProjectionWriteStore extends GrantProjectionWriteStore {
  async append(_write: GrantProjectionWrite, _context: ProjectionStoreContext): Promise<void> {}
}

class NullAuthzAuditTrailStore extends AuthzAuditTrailStore {
  async insert(_row: AuthzAuditRow): Promise<void> {}
}

type EventEmitter = {
  handle(command: Command<unknown>): Event[] | Promise<Event[]>;
};

async function emit(handler: EventEmitter, data: unknown): Promise<Event[]> {
  return await handler.handle({
    tenantId: createTenantId(ORGANIZATION_ID),
    aggregateId: "ignored-by-handler",
    type: "test.command",
    data,
  });
}

function buildPipeline() {
  return EventingAuthzAdapter.build({
    authzGrantsWriteStore: new NullGrantProjectionWriteStore(),
    authzAuditTrailStore: new NullAuthzAuditTrailStore(),
  });
}

describe("EventingAuthzAdapter", () => {
  /** @scenario "Eventing registration is explicit" */
  it("builds the existing topology only when explicitly asked", () => {
    const pipeline = buildPipeline();

    expect(pipeline.metadata.name).toBe(AUTHZ_GRANT_PIPELINE_NAME);
    expect(pipeline.metadata.aggregateType).toBe(AUTHZ_GRANT_AGGREGATE_TYPE);
    expect(pipeline.metadata.allowedEventTypes).toEqual([...AUTHZ_GRANTS_EVENT_TYPES]);
    expect(pipeline.commands.map(({ name }) => name)).toEqual([
      "attachGrant",
      "changeGrantRole",
      "revokeGrant",
      "defineRole",
      "changeRolePermissions",
      "deleteRole",
    ]);
    expect([...pipeline.mapProjections.keys()]).toEqual(["authzGrantsWrite"]);
    expect([...pipeline.eventSubscribers.keys()]).toEqual(["auditTrail"]);
  });

  it.each([
    ["attach grant", new AttachGrantCommand(), { ...IDENTITY, grant: GRANT }, "grant_1"],
    [
      "change grant role",
      new ChangeGrantRoleCommand(),
      {
        ...IDENTITY,
        grantId: "grant_1",
        from: "member",
        to: "admin",
        actor: ACTOR,
        occurredAtMs: OCCURRED_AT,
      },
      "grant_1",
    ],
    [
      "revoke grant",
      new RevokeGrantCommand(),
      {
        ...IDENTITY,
        grantId: "grant_1",
        actor: ACTOR,
        occurredAtMs: OCCURRED_AT,
      },
      "grant_1",
    ],
    ["define role", new DefineRoleCommand(), { ...IDENTITY, role: ROLE, actor: ACTOR }, "role_1"],
    [
      "change role permissions",
      new ChangeRolePermissionsCommand(),
      {
        ...IDENTITY,
        roleId: "role_1",
        permissions: ["traces:view"],
        actor: ACTOR,
        occurredAtMs: OCCURRED_AT,
      },
      "role_1",
    ],
    [
      "delete role",
      new DeleteRoleCommand(),
      {
        ...IDENTITY,
        roleId: "role_1",
        actor: ACTOR,
        occurredAtMs: OCCURRED_AT,
      },
      "role_1",
    ],
  ])(
    "preserves aggregate, tenant, version, and retry identity for %s",
    async (_label, handler, data, aggregateId) => {
      const [event] = await emit(handler as unknown as EventEmitter, data);

      expect(event).toMatchObject({
        aggregateType: "authz_grant",
        aggregateId,
        tenantId: ORGANIZATION_ID,
        version: AUTHZ_GRANTS_EVENT_VERSION_LATEST,
        occurredAt: OCCURRED_AT,
        idempotencyKey: "cmd_1:0",
      });
    },
  );

  it("uses the portable command schema, including the tenant identity invariant", () => {
    const valid = AttachGrantCommand.schema.validate({
      ...IDENTITY,
      grant: GRANT,
    });
    const invalid = AttachGrantCommand.schema.validate({
      ...IDENTITY,
      tenantId: "org_other",
      grant: GRANT,
    });

    expect(valid.success).toBe(true);
    expect(invalid.success).toBe(false);
  });
});

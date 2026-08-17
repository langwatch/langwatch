import { describe, expect, it } from "vitest";
import { createTenantId, EventUtils } from "../../..";
import type { Command } from "../../../commands/command";
import {
  AttachGrantsCommand,
  ChangeGrantRoleCommand,
  DefineRolesCommand,
  DeleteRoleCommand,
  OffboardMemberCommand,
  RecordMigrationTenantStateCommand,
  RollBackCutoverCommand,
} from "../commands/grantsLedgerCommands";
import { AuthzGrantsStateFoldProjection } from "../projections/authzGrantsState.foldProjection";
import {
  type AttachGrantsCommandData,
  attachGrantsCommandDataSchema,
  type ChangeGrantRoleCommandData,
  type DefineRolesCommandData,
  type DeleteRoleCommandData,
  type OffboardMemberCommandData,
} from "../schemas/commands";
import {
  AUTHZ_GRANTS_AGGREGATE_TYPE,
  AUTHZ_GRANTS_EVENT_VERSION_LATEST,
  CUTOVER_COMPLETED_EVENT_TYPE,
  GRANT_ATTACHED_EVENT_TYPE,
  GRANT_REVOKED_EVENT_TYPE,
  GRANT_ROLE_CHANGED_EVENT_TYPE,
  MEMBER_OFFBOARDED_EVENT_TYPE,
  MIGRATION_TENANT_STATE_CHANGED_EVENT_TYPE,
  ROLE_DEFINED_EVENT_TYPE,
  ROLE_DELETED_EVENT_TYPE,
} from "../schemas/constants";
import type { AuthzGrantsEvent } from "../schemas/events";

const ORG = "org_acme";
const ACTOR = { type: "user" as const, id: "user_admin" };

function command<T>(data: T): Command<T> {
  return {
    tenantId: createTenantId(ORG),
    aggregateId: ORG,
    type: "lw.authz_grants.attach_grants",
    data,
  } as Command<T>;
}

function attachEntry(overrides?: Record<string, unknown>) {
  return {
    grantId: "grant_1",
    principal: { type: "user" as const, id: "user_alice" },
    roleKey: "member",
    scope: { type: "TEAM" as const, id: "team_client_a" },
    source: "backfill-b" as const,
    actor: ACTOR,
    occurredAtMs: 1_700_000_000_000,
    ...overrides,
  };
}

describe("attachGrants command", () => {
  describe("when a batch of facts is attached", () => {
    it("emits one event per fact, each carrying its own business time", async () => {
      const events = await new AttachGrantsCommand().handle(
        command<AttachGrantsCommandData>({
          tenantId: ORG,
          organizationId: ORG,
          commandId: "cmd_1",
          grants: [
            attachEntry(),
            attachEntry({
              grantId: "grant_2",
              occurredAtMs: 1_700_000_099_000,
            }),
          ],
        }),
      );
      expect(events).toHaveLength(2);
      expect(events[0]!.aggregateId).toBe(ORG);
      expect(events[0]!.occurredAt).toBe(1_700_000_000_000);
      expect(events[1]!.occurredAt).toBe(1_700_000_099_000);
      expect(events.every((e) => e.type === GRANT_ATTACHED_EVENT_TYPE)).toBe(
        true,
      );
    });

    it("keys idempotency as commandId:index, so a retry dedupes and a repeat never can", async () => {
      const handler = new AttachGrantsCommand();
      const data = {
        tenantId: ORG,
        organizationId: ORG,
        commandId: "cmd_1",
        grants: [attachEntry(), attachEntry({ grantId: "grant_2" })],
      };
      const first = await handler.handle(
        command<AttachGrantsCommandData>(data),
      );
      const retry = await handler.handle(
        command<AttachGrantsCommandData>(data),
      );
      expect(first.map((e) => e.idempotencyKey)).toEqual([
        "cmd_1:0",
        "cmd_1:1",
      ]);
      expect(retry.map((e) => e.idempotencyKey)).toEqual(
        first.map((e) => e.idempotencyKey),
      );
      const repeat = await handler.handle(
        command<AttachGrantsCommandData>({ ...data, commandId: "cmd_2" }),
      );
      expect(repeat[0]!.idempotencyKey).not.toBe(first[0]!.idempotencyKey);
    });

    /** @scenario "Cutover imports the legacy facts that only exist outside bindings" */
    it("carries a cutover-imported share link's whole terms through to the event", async () => {
      // The command schema embeds the shared resource-terms schema, so the
      // cutover's emission rides it without a mapping of its own; validate
      // through the schema the pipeline registers, then through the handler.
      const entry = attachEntry({
        grantId: "share_1",
        principal: { type: "anyone" as const, id: null },
        roleKey: null,
        scope: { type: "RESOURCE" as const, id: "trace_1" },
        source: "cutover-import" as const,
        resource: {
          kind: "trace" as const,
          projectId: "proj_chatbot",
          token: "tok_abc",
          permission: "traces:view",
          createdByUserId: "user_sam",
          expiresAtMs: 1_700_000_600_000,
          maxViews: 5,
        },
      });
      const data = {
        tenantId: ORG,
        organizationId: ORG,
        commandId: "cutover:share-links:org_acme:0",
        grants: [entry],
      };
      expect(() => attachGrantsCommandDataSchema.parse(data)).not.toThrow();

      const [event] = await new AttachGrantsCommand().handle(
        command<AttachGrantsCommandData>(data),
      );

      expect(event!.data).toMatchObject({
        grantId: "share_1",
        roleKey: null,
        scope: { type: "RESOURCE", id: "trace_1" },
        source: "cutover-import",
        resource: {
          kind: "trace",
          projectId: "proj_chatbot",
          token: "tok_abc",
          permission: "traces:view",
          createdByUserId: "user_sam",
          expiresAtMs: 1_700_000_600_000,
          maxViews: 5,
        },
      });
    });

    it("keeps business time out of the payload — it rides the envelope only", async () => {
      const [event] = await new AttachGrantsCommand().handle(
        command<AttachGrantsCommandData>({
          tenantId: ORG,
          organizationId: ORG,
          commandId: "cmd_1",
          grants: [attachEntry()],
        }),
      );
      expect(event!.data).not.toHaveProperty("occurredAtMs");
    });
  });
});

describe("authzGrantsState projection", () => {
  const projection = new AuthzGrantsStateFoldProjection({
    store: {
      load: () => Promise.resolve(null),
      store: () => Promise.resolve(),
    },
  });

  function ledgerEvent(
    type: AuthzGrantsEvent["type"],
    data: AuthzGrantsEvent["data"],
    occurredAt = 1_700_000_000_000,
  ): AuthzGrantsEvent {
    return EventUtils.createEvent<AuthzGrantsEvent>({
      aggregateType: AUTHZ_GRANTS_AGGREGATE_TYPE,
      aggregateId: ORG,
      tenantId: createTenantId(ORG),
      type,
      version: AUTHZ_GRANTS_EVENT_VERSION_LATEST,
      data,
      metadata: {},
      occurredAt,
    });
  }

  describe("when events fold through the reducer", () => {
    it("attaches, learns the organization, and carries the envelope's business time onto the fact", () => {
      const state = projection.apply(
        projection.init(),
        ledgerEvent(GRANT_ATTACHED_EVENT_TYPE, {
          grantId: "grant_1",
          principal: { type: "user", id: "user_alice" },
          roleKey: "member",
          scope: { type: "TEAM", id: "team_client_a" },
          source: "backfill-b",
          actor: ACTOR,
        }),
      );
      expect(state.organizationId).toBe(ORG);
      expect(state.grants.grant_1?.occurredAtMs).toBe(1_700_000_000_000);
    });

    it("revokes an attached grant and flips the cutover latch", () => {
      let state = projection.init();
      state = projection.apply(
        state,
        ledgerEvent(GRANT_ATTACHED_EVENT_TYPE, {
          grantId: "grant_1",
          principal: { type: "user", id: "user_alice" },
          roleKey: "member",
          scope: { type: "TEAM", id: "team_client_a" },
          source: "grants-service",
          actor: ACTOR,
        }),
      );
      state = projection.apply(
        state,
        ledgerEvent(GRANT_REVOKED_EVENT_TYPE, {
          grantId: "grant_1",
          actor: ACTOR,
        }),
      );
      state = projection.apply(
        state,
        ledgerEvent(CUTOVER_COMPLETED_EVENT_TYPE, { actor: ACTOR }),
      );
      expect(state.grants.grant_1).toBeUndefined();
      expect(state.cutover.onEngine).toBe(true);
    });

    it("sweeps the grants an offboarding never listed, which is how a lagging projection cannot leave access standing", () => {
      let state = projection.init();
      // The writer resolved `revokedGrantIds` from the compat projection, a
      // fold behind: `grant_2` was appended a moment earlier and is invisible
      // to that query.
      for (const grantId of ["grant_1", "grant_2"]) {
        state = projection.apply(
          state,
          ledgerEvent(GRANT_ATTACHED_EVENT_TYPE, {
            grantId,
            principal: { type: "user", id: "user_alice" },
            roleKey: "member",
            scope: { type: "TEAM", id: "team_client_a" },
            source: "grants-service",
            actor: ACTOR,
          }),
        );
      }
      state = projection.apply(
        state,
        ledgerEvent(MEMBER_OFFBOARDED_EVENT_TYPE, {
          userId: "user_alice",
          revokedGrantIds: ["grant_1"],
          actor: ACTOR,
        }),
      );

      expect(state.grants.grant_1).toBeUndefined();
      expect(state.grants.grant_2).toBeUndefined();
    });

    it("sweeps by the identity a filtered revocation named", () => {
      let state = projection.init();
      state = projection.apply(
        state,
        ledgerEvent(GRANT_ATTACHED_EVENT_TYPE, {
          grantId: "grant_key",
          principal: { type: "api_key", id: "key_1" },
          roleKey: "member",
          scope: { type: "PROJECT", id: "proj_chatbot" },
          source: "grants-service",
          actor: ACTOR,
        }),
      );
      state = projection.apply(
        state,
        ledgerEvent(GRANT_REVOKED_EVENT_TYPE, {
          selector: { principal: { type: "api_key", id: "key_1" } },
          actor: ACTOR,
        }),
      );

      expect(state.grants.grant_key).toBeUndefined();
    });

    it("leaves state untouched for an event from another aggregate", () => {
      // The base class's contract: routing guarantees only declared types
      // arrive, so an undeclared type is returned unfolded — the SAME
      // state reference, proving nothing was applied or stamped.
      const foreign = {
        ...ledgerEvent(GRANT_REVOKED_EVENT_TYPE, {
          grantId: "grant_1",
          actor: ACTOR,
        }),
        type: "lw.obs.trace.span_received",
      } as unknown as AuthzGrantsEvent;
      const initial = projection.init();
      expect(projection.apply(initial, foreign)).toBe(initial);
    });
  });
});

describe("rollBackCutover command", () => {
  it("emits the rollback fact with the command's own business time", async () => {
    const [event] = await new RollBackCutoverCommand().handle({
      tenantId: createTenantId(ORG),
      aggregateId: ORG,
      type: "lw.authz_grants.roll_back_cutover",
      data: {
        tenantId: ORG,
        organizationId: ORG,
        commandId: "cmd_rb",
        actor: ACTOR,
        reason: "parity regression",
        occurredAtMs: 1_700_000_500_000,
      },
    } as never);
    expect(event!.occurredAt).toBe(1_700_000_500_000);
    expect(event!.idempotencyKey).toBe("cmd_rb:0");
  });
});

/**
 * The rest of the ledger's write verbs, held to the same four promises the
 * batched writer above is: the aggregate is the organization, the envelope's
 * tenant is stamped onto the event, the payload carries the whole fact, and
 * the idempotency key is `<commandId>:<index>` so a retry dedupes at the
 * event store while a genuinely repeated action never can.
 */
describe("changeGrantRole command", () => {
  const data: ChangeGrantRoleCommandData = {
    tenantId: ORG,
    organizationId: ORG,
    commandId: "cmd_role",
    grantId: "grant_1",
    from: "member",
    to: "admin",
    actor: ACTOR,
    occurredAtMs: 1_700_000_700_000,
  };

  describe("when one grant's role changes", () => {
    it("names the organization as the aggregate", () => {
      expect(ChangeGrantRoleCommand.getAggregateId(data)).toBe(ORG);
    });

    it("emits one fact carrying both role keys and the grant's identity", async () => {
      const events = await new ChangeGrantRoleCommand().handle(
        command<ChangeGrantRoleCommandData>(data),
      );

      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe(GRANT_ROLE_CHANGED_EVENT_TYPE);
      expect(events[0]!.aggregateId).toBe(ORG);
      expect(events[0]!.tenantId).toBe(ORG);
      expect(events[0]!.data).toEqual({
        grantId: "grant_1",
        from: "member",
        to: "admin",
        actor: ACTOR,
      });
      expect(events[0]!.occurredAt).toBe(1_700_000_700_000);
      expect(events[0]!.idempotencyKey).toBe("cmd_role:0");
    });

    it("keys a retry the same and a repeat differently", async () => {
      const handler = new ChangeGrantRoleCommand();
      const [retry] = await handler.handle(
        command<ChangeGrantRoleCommandData>(data),
      );
      const [repeat] = await handler.handle(
        command<ChangeGrantRoleCommandData>({ ...data, commandId: "cmd_2" }),
      );

      expect(retry!.idempotencyKey).toBe("cmd_role:0");
      expect(repeat!.idempotencyKey).toBe("cmd_2:0");
    });
  });
});

describe("defineRoles command", () => {
  function roleEntry(overrides?: Record<string, unknown>) {
    return {
      roleId: "role_1",
      name: "Auditor",
      permissions: ["traces:read"],
      kind: "custom" as const,
      occurredAtMs: 1_700_000_000_000,
      ...overrides,
    };
  }

  const data: DefineRolesCommandData = {
    tenantId: ORG,
    organizationId: ORG,
    commandId: "cmd_roles",
    roles: [roleEntry(), roleEntry({ roleId: "role_2", name: "Reviewer" })],
    actor: ACTOR,
  };

  describe("when a batch of definitions is recorded", () => {
    it("names the organization as the aggregate", () => {
      expect(DefineRolesCommand.getAggregateId(data)).toBe(ORG);
    });

    it("emits one fact per role, each keyed by its position in the batch", async () => {
      const events = await new DefineRolesCommand().handle(
        command<DefineRolesCommandData>(data),
      );

      expect(events).toHaveLength(2);
      expect(events.every((e) => e.type === ROLE_DEFINED_EVENT_TYPE)).toBe(
        true,
      );
      expect(events.every((e) => e.tenantId === ORG)).toBe(true);
      expect(events.every((e) => e.aggregateId === ORG)).toBe(true);
      expect(events.map((e) => e.idempotencyKey)).toEqual([
        "cmd_roles:0",
        "cmd_roles:1",
      ]);
      expect(events[0]!.data).toEqual({
        roleId: "role_1",
        name: "Auditor",
        permissions: ["traces:read"],
        kind: "custom",
        actor: ACTOR,
      });
    });

    it("keeps business time out of the payload — it rides the envelope only", async () => {
      const [event] = await new DefineRolesCommand().handle(
        command<DefineRolesCommandData>({
          ...data,
          roles: [roleEntry({ occurredAtMs: 1_690_000_000_000 })],
        }),
      );

      expect(event!.data).not.toHaveProperty("occurredAtMs");
      expect(event!.occurredAt).toBe(1_690_000_000_000);
    });
  });
});

describe("deleteRole command", () => {
  const data: DeleteRoleCommandData = {
    tenantId: ORG,
    organizationId: ORG,
    commandId: "cmd_delete",
    roleId: "role_1",
    actor: ACTOR,
    occurredAtMs: 1_700_000_800_000,
  };

  describe("when one definition is deleted", () => {
    it("names the organization as the aggregate", () => {
      expect(DeleteRoleCommand.getAggregateId(data)).toBe(ORG);
    });

    it("emits one fact naming the role and the actor who removed it", async () => {
      const events = await new DeleteRoleCommand().handle(
        command<DeleteRoleCommandData>(data),
      );

      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe(ROLE_DELETED_EVENT_TYPE);
      expect(events[0]!.aggregateId).toBe(ORG);
      expect(events[0]!.tenantId).toBe(ORG);
      expect(events[0]!.data).toEqual({ roleId: "role_1", actor: ACTOR });
      expect(events[0]!.occurredAt).toBe(1_700_000_800_000);
      expect(events[0]!.idempotencyKey).toBe("cmd_delete:0");
    });
  });
});

describe("offboardMember command", () => {
  const data: OffboardMemberCommandData = {
    tenantId: ORG,
    organizationId: ORG,
    commandId: "cmd_offboard",
    userId: "user_alice",
    revokedGrantIds: ["grant_1", "grant_2"],
    actor: ACTOR,
    occurredAtMs: 1_700_000_900_000,
  };

  describe("when a member departs", () => {
    it("names the organization as the aggregate", () => {
      expect(OffboardMemberCommand.getAggregateId(data)).toBe(ORG);
    });

    it("emits one fact carrying the member and the grants the writer could see", async () => {
      const events = await new OffboardMemberCommand().handle(
        command<OffboardMemberCommandData>(data),
      );

      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe(MEMBER_OFFBOARDED_EVENT_TYPE);
      expect(events[0]!.aggregateId).toBe(ORG);
      expect(events[0]!.tenantId).toBe(ORG);
      expect(events[0]!.data).toEqual({
        userId: "user_alice",
        revokedGrantIds: ["grant_1", "grant_2"],
        actor: ACTOR,
      });
      expect(events[0]!.occurredAt).toBe(1_700_000_900_000);
      expect(events[0]!.idempotencyKey).toBe("cmd_offboard:0");
    });
  });
});

describe("recordMigrationTenantState command", () => {
  it("witnesses one lifecycle transition with the runner's report attached", async () => {
    const [event] = await new RecordMigrationTenantStateCommand().handle({
      tenantId: createTenantId(ORG),
      aggregateId: ORG,
      type: "lw.authz_grants.record_migration_tenant_state",
      data: {
        tenantId: ORG,
        organizationId: ORG,
        commandId: "cmd_witness",
        migrationName: "authz-team-user-backfill",
        status: "parked",
        report: { kind: "error", message: "boom" },
        actor: { type: "system", id: "system:migration-runner" },
        occurredAtMs: 1_700_000_600_000,
      },
    } as never);
    expect(event!.type).toBe(MIGRATION_TENANT_STATE_CHANGED_EVENT_TYPE);
    expect(event!.data).toMatchObject({
      migrationName: "authz-team-user-backfill",
      status: "parked",
      report: { kind: "error", message: "boom" },
    });
    expect(event!.occurredAt).toBe(1_700_000_600_000);
    expect(event!.idempotencyKey).toBe("cmd_witness:0");
  });
});

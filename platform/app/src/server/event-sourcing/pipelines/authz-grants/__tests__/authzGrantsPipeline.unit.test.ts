import { describe, expect, it } from "vitest";
import { createTenantId, EventUtils } from "../../..";
import type { Command } from "../../../commands/command";
import {
  AttachGrantsCommand,
  RecordMigrationTenantStateCommand,
  RollBackCutoverCommand,
} from "../commands/grantsLedgerCommands";
import { AuthzGrantsStateFoldProjection } from "../projections/authzGrantsState.foldProjection";
import type { AttachGrantsCommandData } from "../schemas/commands";
import {
  AUTHZ_GRANTS_AGGREGATE_TYPE,
  AUTHZ_GRANTS_EVENT_VERSION_LATEST,
  CUTOVER_COMPLETED_EVENT_TYPE,
  GRANT_ATTACHED_EVENT_TYPE,
  GRANT_REVOKED_EVENT_TYPE,
  MIGRATION_TENANT_STATE_CHANGED_EVENT_TYPE,
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

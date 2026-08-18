/**
 * What the runner runs, and in what order. The order is the contract: the
 * genesis import adopts the backfill's rows, and the cutover imports what
 * both leave behind before it flips the organization onto the engine.
 *
 * And what the OPS service is composed with, which the same root decides: the
 * cutover's rollback effect is an optional dependency, so nothing but a test
 * that drives the exported service proves it was passed. These tests call the
 * production `systemMigrationsService` and watch what it does to the stubbed
 * storage underneath - a name check would pass on a service wired with an
 * empty effects map.
 *
 * Everything storage-shaped is stubbed - the composition root is what is
 * under test, not Prisma, Redis or the event-sourcing stack.
 */

import { TEAM_USER_BACKFILL_MIGRATION_NAME } from "@langwatch/authz-server";
import {
  GRANTS_CUTOVER_MIGRATION_NAME,
  GRANTS_GENESIS_IMPORT_MIGRATION_NAME,
} from "@langwatch/authz-server/migration";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ORGANIZATION_ID = "org_acme";

const stubs = vi.hoisted(() => {
  const migrationStateFindUnique = vi.fn();
  const migrationStateUpsert = vi.fn();
  const cutoverProjectionUpsert = vi.fn();
  const rollBackCutoverSend = vi.fn();
  const recordMigrationTenantStateSend = vi.fn();
  return {
    migrationStateFindUnique,
    migrationStateUpsert,
    cutoverProjectionUpsert,
    rollBackCutoverSend,
    recordMigrationTenantStateSend,
    prisma: {
      systemMigrationTenantState: {
        findUnique: migrationStateFindUnique,
        upsert: migrationStateUpsert,
      },
      authzCutoverProjection: { upsert: cutoverProjectionUpsert },
    },
  };
});

vi.mock("~/server/db", () => ({ prisma: stubs.prisma }));
vi.mock("~/env.mjs", () => ({ env: { IS_SAAS: false } }));
vi.mock("@ee/audit-log/auditLog", () => ({ auditLog: vi.fn() }));
vi.mock("../../app", () => ({ tryGetApp: () => null }));
vi.mock("../../authz/epoch", () => ({
  bumpAuthzEpoch: vi.fn(),
  getAuthzEpoch: vi.fn(),
}));
vi.mock("../../authz/ledger", () => ({
  authzGrantsCommands: vi.fn(async () => ({
    commands: {
      rollBackCutover: { send: stubs.rollBackCutoverSend },
      recordMigrationTenantState: {
        send: stubs.recordMigrationTenantStateSend,
      },
    },
  })),
}));
vi.mock("../../authz/runtime", () => ({ authzCollector: {} }));

import { bumpAuthzEpoch } from "../../authz/epoch";
import { registeredMigrations, systemMigrationsService } from "../runtime";

describe("registeredMigrations", () => {
  describe("when the runner asks what to run", () => {
    it("answers with the three in-place migrations, cutover last", () => {
      expect(registeredMigrations().map((migration) => migration.name)).toEqual(
        [
          TEAM_USER_BACKFILL_MIGRATION_NAME,
          GRANTS_GENESIS_IMPORT_MIGRATION_NAME,
          GRANTS_CUTOVER_MIGRATION_NAME,
        ],
      );
    });
  });
});

describe("systemMigrationsService", () => {
  /** The stored row, behaving like the table: what upsert writes, findUnique reads. */
  function storedState(initial: { status: string; report: unknown }): {
    current: () => { status: string; report: unknown };
  } {
    let row = {
      migrationName: GRANTS_CUTOVER_MIGRATION_NAME,
      tenantId: ORGANIZATION_ID,
      ...initial,
    };
    stubs.migrationStateFindUnique.mockImplementation(() =>
      Promise.resolve(row),
    );
    stubs.migrationStateUpsert.mockImplementation(
      ({ update }: { update: { status: string; report: unknown } }) => {
        row = { ...row, status: update.status, report: update.report };
        return Promise.resolve(row);
      },
    );
    return { current: () => row };
  }

  const rollBack = () =>
    systemMigrationsService.rollBack({
      migrationName: GRANTS_CUTOVER_MIGRATION_NAME,
      tenantId: ORGANIZATION_ID,
      actorUserId: "user_alex",
    });

  beforeEach(() => {
    vi.clearAllMocks();
    stubs.rollBackCutoverSend.mockResolvedValue(undefined);
    stubs.recordMigrationTenantStateSend.mockResolvedValue(undefined);
    stubs.cutoverProjectionUpsert.mockResolvedValue(undefined);
  });

  describe("given the cutover migration and a finalized organization", () => {
    describe("when an operator rolls it back", () => {
      /** @scenario "Rolling back a cutover takes effect without a deploy, even with the queue stopped" */
      it("takes the organization off the engine, which proves the effect is wired", async () => {
        storedState({ status: "finalized", report: { parity: "clean" } });

        await rollBack();

        // The enforcement authority: the projection every fork reads.
        expect(stubs.cutoverProjectionUpsert).toHaveBeenCalledWith({
          where: { organizationId: ORGANIZATION_ID },
          create: { organizationId: ORGANIZATION_ID, onEngine: false },
          update: { onEngine: false },
        });
        expect(bumpAuthzEpoch).toHaveBeenCalledWith({
          organizationId: ORGANIZATION_ID,
        });
        expect(stubs.rollBackCutoverSend).toHaveBeenCalledTimes(1);
      });

      it("enforces the rollback before it tells the ledger about it", async () => {
        storedState({ status: "finalized", report: null });
        const order: string[] = [];
        stubs.cutoverProjectionUpsert.mockImplementation(() => {
          order.push("enforce");
          return Promise.resolve();
        });
        stubs.rollBackCutoverSend.mockImplementation(() => {
          order.push("append");
          return Promise.resolve();
        });

        await rollBack();

        expect(order).toEqual(["enforce", "append"]);
      });

      it("holds the enforcement when the ledger append fails", async () => {
        storedState({ status: "finalized", report: null });
        stubs.rollBackCutoverSend.mockRejectedValue(
          new Error("event store unreachable"),
        );

        await expect(rollBack()).resolves.toBeUndefined();

        expect(stubs.cutoverProjectionUpsert).toHaveBeenCalledTimes(1);
        expect(bumpAuthzEpoch).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("given a rollback whose ledger append failed", () => {
    describe("when the operator retries it", () => {
      /** @scenario "An operator retries a rollback whose effect did not fully apply" */
      it("re-enforces and appends under the id the first attempt used", async () => {
        const state = storedState({
          status: "finalized",
          report: { parity: "clean" },
        });
        stubs.rollBackCutoverSend.mockRejectedValueOnce(
          new Error("event store unreachable"),
        );

        await rollBack();
        expect(state.current().status).toBe("rolled_back");
        await rollBack();

        expect(stubs.cutoverProjectionUpsert).toHaveBeenCalledTimes(2);
        expect(stubs.rollBackCutoverSend).toHaveBeenCalledTimes(2);
        const [first, second] = stubs.rollBackCutoverSend.mock.calls as Array<
          [{ commandId: string; occurredAtMs: number }]
        >;
        // Same command id, so the event store's idempotency key makes the
        // retry one rollback rather than two.
        expect(second?.[0].commandId).toBe(first?.[0].commandId);
        expect(second?.[0].occurredAtMs).toBe(first?.[0].occurredAtMs);
        // And only one pin was ever written.
        expect(stubs.migrationStateUpsert).toHaveBeenCalledTimes(1);
      });
    });
  });
});

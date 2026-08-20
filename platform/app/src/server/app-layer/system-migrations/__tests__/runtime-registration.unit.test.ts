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
  const cutoverProjectionFindUnique = vi.fn();
  const rollBackCutoverSend = vi.fn();
  const recordMigrationTenantStateSend = vi.fn();
  return {
    migrationStateFindUnique,
    migrationStateUpsert,
    cutoverProjectionUpsert,
    cutoverProjectionFindUnique,
    rollBackCutoverSend,
    recordMigrationTenantStateSend,
    prisma: {
      systemMigrationTenantState: {
        findUnique: migrationStateFindUnique,
        upsert: migrationStateUpsert,
      },
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
import {
  MigrationRollbackBlockedByDependentError,
  MigrationRollbackCutoverNotStartedError,
} from "../errors";
import {
  cutoverEnrollmentCohort,
  registeredMigrations,
  systemMigrationsService,
} from "../runtime";

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

    /** @scenario "Self-hosted installations run the preparation work but not the cutover yet" */
    it("declares the preparation work released for self-hosting and the cutover not yet", () => {
      // These declarations ARE the self-hosted release act: flipping the
      // cutover's to true is done in a later release, after the cloud soak.
      const declarations = Object.fromEntries(
        registeredMigrations().map((migration) => [
          migration.name,
          migration.runsAutomaticallyOnSelfHosted,
        ]),
      );
      expect(declarations).toEqual({
        [TEAM_USER_BACKFILL_MIGRATION_NAME]: true,
        [GRANTS_GENESIS_IMPORT_MIGRATION_NAME]: true,
        [GRANTS_CUTOVER_MIGRATION_NAME]: false,
      });
    });
  });
});

describe("cutoverEnrollmentCohort on a self-hosted installation", () => {
  describe("when the runner asks whether a tenant may cut over", () => {
    it("answers true without reading enrollment - reaching here means the release declaration admitted the cutover", async () => {
      // The prisma stub has no enrollment model at all, so a read would throw:
      // resolving true proves the self-hosted arm never touches the table.
      await expect(cutoverEnrollmentCohort("org_acme")).resolves.toBe(true);
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

  /** Several migrations' rows at once, keyed by name - the dependency
   *  guards read a DIFFERENT row than the one being rolled back. */
  function storedStates(
    rows: Record<string, { status: string; report: unknown }>,
  ): void {
    stubs.migrationStateFindUnique.mockImplementation(
      ({
        where,
      }: {
        where: { migrationName_tenantId: { migrationName: string } };
      }) => {
        const row = rows[where.migrationName_tenantId.migrationName];
        return Promise.resolve(
          row
            ? {
                migrationName: where.migrationName_tenantId.migrationName,
                tenantId: ORGANIZATION_ID,
                ...row,
              }
            : null,
        );
      },
    );
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
    // No projection row unless a test says otherwise: off the engine, no
    // cutover fact folded yet.
    stubs.cutoverProjectionFindUnique.mockResolvedValue(null);
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

  describe("given a worker clock ahead of this pod's when the cutover completed", () => {
    describe("when an operator rolls the organization back", () => {
      /** @scenario "A rollback fact lands however the pods' clocks disagree" */
      it("stamps the fact past the completion so the fold cannot drop it as stale", async () => {
        storedState({ status: "finalized", report: { parity: "clean" } });
        // The completion's business time, folded by a WORKER whose clock ran
        // ahead of this web pod's. A fact stamped from this pod's clock alone
        // would trail it and be silently dropped by the reducer's monotonic
        // guard - permanently, since the retry reuses the same command id.
        const completionChangedAt = new Date(Date.now() + 5 * 60_000);
        stubs.cutoverProjectionFindUnique.mockResolvedValue({
          onEngine: true,
          changedAt: completionChangedAt,
        });

        await rollBack();

        const [call] = stubs.rollBackCutoverSend.mock.calls as Array<
          [{ commandId: string; occurredAtMs: number }]
        >;
        expect(call?.[0].occurredAtMs).toBe(completionChangedAt.getTime() + 1);
        // The id still keys on the DECISION, so retries of it dedupe.
        expect(call?.[0].commandId).toMatch(
          new RegExp(`^cutover:rollback:${ORGANIZATION_ID}:`),
        );
      });
    });
  });

  describe("given a cutover that is merely waiting, never started", () => {
    describe("when an operator tries to roll it back", () => {
      /** @scenario "Rolling back a cutover that never started is refused" */
      it("refuses with migration_rollback_cutover_not_started and pins nothing", async () => {
        storedState({
          status: "migrated",
          report: { kind: "cutover_waiting_cohort" },
        });

        const attempt = rollBack();

        await expect(attempt).rejects.toThrow(
          MigrationRollbackCutoverNotStartedError,
        );
        await attempt.catch(
          (error: MigrationRollbackCutoverNotStartedError) => {
            expect(error.code).toBe("migration_rollback_cutover_not_started");
          },
        );
        // Nothing pinned, nothing enforced, nothing appended: the tenant
        // stays exactly where the runner will pick it up once its wait ends.
        expect(stubs.migrationStateUpsert).not.toHaveBeenCalled();
        expect(stubs.cutoverProjectionUpsert).not.toHaveBeenCalled();
        expect(stubs.rollBackCutoverSend).not.toHaveBeenCalled();
      });

      it("still lets an organization that IS on the engine be pulled back, whatever its report says", async () => {
        storedState({
          status: "migrated",
          report: { kind: "cutover_waiting" },
        });
        stubs.cutoverProjectionFindUnique.mockResolvedValue({
          onEngine: true,
          changedAt: new Date(),
        });

        await rollBack();

        expect(stubs.cutoverProjectionUpsert).toHaveBeenCalledTimes(1);
        expect(stubs.rollBackCutoverSend).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("given an organization whose cutover is finalized", () => {
    const rollBackGenesis = () =>
      systemMigrationsService.rollBack({
        migrationName: GRANTS_GENESIS_IMPORT_MIGRATION_NAME,
        tenantId: ORGANIZATION_ID,
        actorUserId: "user_alex",
      });

    describe("when an operator tries to roll back the genesis import underneath it", () => {
      /** @scenario "A migration the cutover stands on cannot be rolled back from under it" */
      it("refuses with migration_rollback_blocked_by_dependent, naming the cutover", async () => {
        storedStates({
          [GRANTS_GENESIS_IMPORT_MIGRATION_NAME]: {
            status: "finalized",
            report: null,
          },
          [GRANTS_CUTOVER_MIGRATION_NAME]: {
            status: "finalized",
            report: { kind: "cutover_clean" },
          },
        });

        const attempt = rollBackGenesis();

        await expect(attempt).rejects.toThrow(
          MigrationRollbackBlockedByDependentError,
        );
        await attempt.catch(
          (error: MigrationRollbackBlockedByDependentError) => {
            expect(error.code).toBe("migration_rollback_blocked_by_dependent");
            expect(error.meta).toMatchObject({
              blockingMigration: GRANTS_CUTOVER_MIGRATION_NAME,
              blockingStatus: "finalized",
            });
          },
        );
        expect(stubs.migrationStateUpsert).not.toHaveBeenCalled();
      });

      it("refuses the team-user backfill on the same grounds", async () => {
        storedStates({
          [TEAM_USER_BACKFILL_MIGRATION_NAME]: {
            status: "finalized",
            report: null,
          },
          [GRANTS_CUTOVER_MIGRATION_NAME]: {
            status: "migrated",
            report: { kind: "cutover_parity_diffs", totalDiffs: 3 },
          },
        });

        await expect(
          systemMigrationsService.rollBack({
            migrationName: TEAM_USER_BACKFILL_MIGRATION_NAME,
            tenantId: ORGANIZATION_ID,
            actorUserId: "user_alex",
          }),
        ).rejects.toThrow(MigrationRollbackBlockedByDependentError);
        expect(stubs.migrationStateUpsert).not.toHaveBeenCalled();
      });
    });

    describe("when the cutover is only waiting on its prerequisites", () => {
      it("lets the genesis import roll back - nothing stands on it yet", async () => {
        storedStates({
          [GRANTS_GENESIS_IMPORT_MIGRATION_NAME]: {
            status: "finalized",
            report: null,
          },
          [GRANTS_CUTOVER_MIGRATION_NAME]: {
            status: "migrated",
            report: { kind: "cutover_waiting", awaiting: [] },
          },
        });

        await rollBackGenesis();

        expect(stubs.migrationStateUpsert).toHaveBeenCalledTimes(1);
        const [call] = stubs.migrationStateUpsert.mock.calls as Array<
          [{ update: { status: string } }]
        >;
        expect(call?.[0].update.status).toBe("rolled_back");
      });
    });
  });
});

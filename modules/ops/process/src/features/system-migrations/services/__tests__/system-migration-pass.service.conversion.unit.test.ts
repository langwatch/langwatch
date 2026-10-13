/**
 * @vitest-environment node
 * The identity and authz migrations ops held, moved to their owners' steps in one release: state
 * copied, re-copied, driven, run, rolled back, and written to ops' older tables too.
 * Spec: modules/ops/specs/ops-system-migrations.feature
 */
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import { InMemoryProcessStore } from "@langwatch/eventing";
import type { IdentityApi } from "@langwatch/identity-contract";
import type { SystemMigration, TenantSource } from "@langwatch/system-migrations";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import {
  type TenantAxis,
  defineMigrationStep,
  type TenantMigrationStep,
} from "@langwatch/upgrade/step";
import { MemoryTenantStepStateRepository } from "@langwatch/upgrade/step/tenant-state";
import { describe, expect, it, vi } from "vitest";

import { MemoryMigrationLeaseRepository } from "../../../../repositories/memory/memory.migration-lease.repository.ts";
import { MemoryOpsMigrationRepository } from "../../../../repositories/memory/memory.ops-migration.repository.ts";
import { MemoryOpsRepositories } from "../../../../repositories/memory/memory.ops.repositories.ts";
import { MemorySystemMigrationEnrollmentRepository } from "../../../../repositories/memory/memory.system-migration-enrollment.repository.ts";
import { MemorySystemMigrationStateRepository } from "../../../../repositories/memory/memory.system-migration-state.repository.ts";
import { NullQueueRepository } from "../../../../repositories/queue.repository.ts";
import { SystemMigrationLegacyMirrorService } from "../system-migration-legacy-mirror.service.ts";
import { SystemMigrationPassService } from "../system-migration-pass.service.ts";

const ENGINE = "authz:engine";
const BACKFILL = "identity:identifier-backfill";
/** The legacy names the copy steps carry over, as ops.module.ts declares them. */
const MOVES = {
  "authz-engine": ENGINE,
  "identity-d01-identifier-backfill": BACKFILL,
} as const;

function pageOf(ids: readonly string[]): TenantSource & { pendingFor: () => TenantSource } {
  const source: TenantSource = {
    findTenantIdsAfter: async ({ cursor }) => (cursor === null ? [...ids] : []),
  };
  return { ...source, pendingFor: () => source };
}

function stepOf({
  id,
  tenants,
  migrateTenant,
  needsOldWritersGone = false,
}: {
  id: string;
  tenants: TenantAxis;
  migrateTenant: SystemMigration["migrateTenant"];
  needsOldWritersGone?: boolean;
}): TenantMigrationStep {
  return defineMigrationStep({
    id,
    kind: "tenant",
    mode: "background",
    tenants,
    title: id,
    description: id,
    requiresOperatorConfirmation: false,
    runsAutomaticallyOnSelfHosted: true,
    enrolledAutomatically: true,
    needsOldWritersGone,
    migrateTenant,
  });
}

function world({ oldWritersGone = true }: { oldWritersGone?: boolean } = {}) {
  const legacy = MemorySystemMigrationStateRepository.create();
  const state = MemoryTenantStepStateRepository.create();
  const enrolments = MemorySystemMigrationEnrollmentRepository.create();
  const copy = MemoryOpsMigrationRepository.create({ legacy, steps: state, enrolments });
  const mirror = SystemMigrationLegacyMirrorService.create({ legacy, moves: MOVES });
  const migrateEngine = vi.fn(async (_tenant: { tenantId: string }) => ({
    status: "finalized" as const,
  }));
  const migrateBackfill = vi.fn(async (_tenant: { tenantId: string }) => ({
    status: "finalized" as const,
  }));
  const steps = [
    stepOf({ id: ENGINE, tenants: "organization", migrateTenant: migrateEngine }),
    stepOf({
      id: BACKFILL,
      tenants: "user",
      migrateTenant: migrateBackfill,
      needsOldWritersGone: true,
    }),
  ];
  const repositories = {
    ...MemoryOpsRepositories.create({
      eventing: { definitions: [] },
      processStore: InMemoryProcessStore.createForTesting(),
    }),
    migrationLease: MemoryMigrationLeaseRepository.create(),
    queues: NullQueueRepository.create(),
    organizationTenants: pageOf(["acme"]),
    userTenants: pageOf(["ann", "gil", "sam"]),
    organizationMemberTenants: { membersOf: () => pageOf(["ann", "sam"]) },
    migrationEnrollments: enrolments,
  };
  const declared = {
    steps: () => steps,
    state,
    settle: { settle: async () => [] },
    oldWritersGoneFor: async () => oldWritersGone,
  };
  const passes = SystemMigrationPassService.create({
    repositories,
    isSaaS: () => false,
    newbornSweep: async () => {},
    declared,
  });
  const recordRolledBack = vi.fn(async () => {});
  const console = SystemMigrationPassService.runner({
    repositories,
    isSaaS: () => false,
    routes: () => new Map(),
    declared,
    legacyMirror: mirror,
    rollbackFacts: { record: recordRolledBack },
    dependencies: {
      identity: createApiFixture<IdentityApi>({}),
      auditLog: createApiFixture<AuditLogApi>({
        record: async () => ({ id: "audit", occurredAt: 0 }),
      }),
    },
    passRequests: { request: async () => {} },
  });
  const statusOf = (migrationName: string, tenantId: string) =>
    state.getRecord({ migrationName, tenantId }).then(
      ({ status, heldReason }) => ({ status, heldReason: heldReason ?? null }),
      () => null,
    );
  const legacyRow = (
    migrationName: string,
    tenantId: string,
    status: "finalized" | "rolled_back" | "migrated",
  ) => legacy.upsertRecord({ migrationName, tenantId, status, report: null });
  const legacyStatusOf = (migrationName: string, tenantId: string) =>
    legacy.getRecord({ migrationName, tenantId }).then(
      ({ status }) => status,
      () => null,
    );
  return {
    legacyRow,
    legacyStatusOf,
    enrolments,
    /** The enrolment store the migrations page writes through. */
    pageEnrolments: mirror.enrollments(enrolments),
    state,
    copy,
    passes,
    console,
    statusOf,
    recordRolledBack,
    migrateEngine,
    migrateBackfill,
  };
}

/** Rows written a moment apart, so which one moved later is never a tie. */
const later = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("converting the identity and authz migrations to their owners' steps", () => {
  describe("given tenants that finished, were rolled back from or never met the old migrations", () => {
    /** @scenario "No tenant is migrated twice in the release that converts the identity and authz migrations" */
    it("migrates only the tenant no old image visited", async () => {
      const { legacyRow, copy, passes, migrateEngine, migrateBackfill } = world();
      await legacyRow("authz-engine", "acme", "finalized");
      await legacyRow("identity-d01-identifier-backfill", "sam", "finalized");
      await legacyRow("identity-d01-identifier-backfill", "ann", "rolled_back");

      await copy.copyTenantState({ moves: MOVES, dryRun: false });
      await passes.runPass({});

      expect(migrateEngine).not.toHaveBeenCalled();
      expect(migrateBackfill.mock.calls.map(([{ tenantId }]) => tenantId)).toEqual(["gil"]);
    });
  });

  describe("given an older image kept writing the old table after the copy", () => {
    /** @scenario "What an older image changed during the rollout reaches the owners' steps once it is gone" */
    it("carries late finishes, rollbacks and reopened accounts over, and keeps a newer pin", async () => {
      const { legacyRow, state, copy, statusOf } = world();
      await legacyRow("identity-d01-identifier-backfill", "unproven", "finalized");
      await legacyRow("identity-d01-identifier-backfill", "pulled", "finalized");
      await legacyRow("identity-d01-identifier-backfill", "pinned", "finalized");
      await copy.copyTenantState({ moves: MOVES, dryRun: false });
      await later();
      await legacyRow("identity-d01-identifier-backfill", "late", "finalized");
      await legacyRow("identity-d01-identifier-backfill", "pulled", "rolled_back");
      await legacyRow("identity-d01-identifier-backfill", "unproven", "migrated");
      await legacyRow("identity-d01-identifier-backfill", "pinned", "finalized");
      await later();
      await state.upsertRecord({
        migrationName: BACKFILL,
        tenantId: "pinned",
        status: "rolled_back",
        report: null,
      });

      expect(await copy.recopyTenantStateAfterRollout({ moves: MOVES, dryRun: true })).toBe(3);
      expect(await statusOf(BACKFILL, "late")).toBeNull();
      expect(await copy.recopyTenantStateAfterRollout({ moves: MOVES, dryRun: false })).toBe(3);

      expect(await statusOf(BACKFILL, "late")).toEqual({ status: "finalized", heldReason: null });
      expect(await statusOf(BACKFILL, "pulled")).toEqual({
        status: "rolled_back",
        heldReason: null,
      });
      expect(await statusOf(BACKFILL, "unproven")).toEqual({
        status: "migrated",
        heldReason: "proof",
      });
      expect(await statusOf(BACKFILL, "pinned")).toEqual({
        status: "rolled_back",
        heldReason: null,
      });
      expect(await copy.recopyTenantStateAfterRollout({ moves: MOVES, dryRun: false })).toBe(0);
    });
  });

  describe("given an operator runs the identifier backfill for one organization", () => {
    /** @scenario "A targeted run of a user step drives the organization's members" */
    it("migrates its members on the step's own state", async () => {
      const { passes, migrateBackfill, statusOf } = world();

      await passes.runTargetedPass({ organizationId: "acme", migrationName: BACKFILL });

      expect(migrateBackfill.mock.calls.map(([{ tenantId }]) => tenantId)).toEqual(["ann", "sam"]);
      expect(await statusOf(BACKFILL, "sam")).toEqual({ status: "finalized", heldReason: null });
    });
  });

  describe("given an older image is still live", () => {
    /** @scenario "A step still waiting for older images is not driven by a targeted run" */
    it("migrates nobody for a step that needs old writers gone", async () => {
      const { passes, migrateBackfill } = world({ oldWritersGone: false });

      await expect(
        passes.runTargetedPass({ organizationId: "acme", migrationName: BACKFILL }),
      ).resolves.toMatchObject({ tenantsSeen: 0 });
      expect(migrateBackfill).not.toHaveBeenCalled();
    });
  });

  describe("given an organization finalized the authorization engine step", () => {
    /** @scenario "An operator's rollback pins the tenant on the step's own state" */
    it("pins it on the step's state and records the rollback under the step's id", async () => {
      const { console, state, statusOf, recordRolledBack } = world();
      await state.upsertRecord({
        migrationName: ENGINE,
        tenantId: "acme",
        status: "finalized",
        report: null,
      });

      await console.rollBack({ migrationName: ENGINE, tenantId: "acme", actorUserId: "op" });

      expect(await statusOf(ENGINE, "acme")).toEqual({ status: "rolled_back", heldReason: null });
      expect(recordRolledBack).toHaveBeenCalledWith(
        expect.objectContaining({ migrationName: ENGINE, tenantId: "acme", actorUserId: "op" }),
      );
    });
  });
  describe("given the older release could still be rolled back to", () => {
    /** @scenario "A rollback to the older release after a tenant finished on the new step keeps it on its new path" */
    it("writes each finish and rollback to ops' older table under the old name", async () => {
      const { console, legacyStatusOf, statusOf } = world();

      await console.runConvergencePass({ signal: new AbortController().signal });
      await console.rollBack({ migrationName: BACKFILL, tenantId: "sam", actorUserId: "op" });

      expect(await statusOf(ENGINE, "acme")).toEqual({ status: "finalized", heldReason: null });
      expect(await legacyStatusOf("authz-engine", "acme")).toBe("finalized");
      expect(await legacyStatusOf("identity-d01-identifier-backfill", "ann")).toBe("finalized");
      expect(await legacyStatusOf("identity-d01-identifier-backfill", "sam")).toBe("rolled_back");
    });
  });

  describe("given an operator withdrew an organization on the older page during the rollout", () => {
    /** @scenario "A withdrawal made on the older page during the rollout is withdrawn on the new step by the re-copy" */
    it("withdraws it on the new step and keeps what the new page enrolled", async () => {
      const { copy, enrolments, pageEnrolments } = world();
      const enrolledBy = "op";
      await enrolments.createMany({
        organizationIds: ["acme", "beta"],
        migrationName: "authz-engine",
        enrolledByUserId: enrolledBy,
      });
      await copy.copyEnrolments({ moves: MOVES, dryRun: false });
      await pageEnrolments.create({
        organizationId: "gamma",
        migrationName: ENGINE,
        enrolledByUserId: enrolledBy,
      });
      await pageEnrolments.delete({ organizationId: "acme", migrationName: ENGINE });
      await enrolments.delete({ organizationId: "beta", migrationName: "authz-engine" });

      expect(await copy.withdrawEnrolmentsAfterRollout({ moves: MOVES, dryRun: true })).toBe(1);
      expect(await copy.copyEnrolments({ moves: MOVES, dryRun: false })).toBe(0);
      expect(await copy.withdrawEnrolmentsAfterRollout({ moves: MOVES, dryRun: false })).toBe(1);

      const enrolled = (await enrolments.findAll())
        .filter(({ migrationName }) => migrationName === ENGINE)
        .map(({ organizationId }) => organizationId);
      expect(enrolled).toEqual(["gamma"]);
      expect(await copy.withdrawEnrolmentsAfterRollout({ moves: MOVES, dryRun: false })).toBe(0);
    });
  });
});

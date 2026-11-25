/**
 * @vitest-environment node
 * Spec: modules/ops/specs/ops-system-migrations.feature
 */
import { MemoryTenantStepStateRepository } from "@langwatch/upgrade/step/tenant-state";
import { describe, expect, it } from "vitest";

import { MemorySystemMigrationEnrollmentRepository } from "../../../../repositories/memory/memory.system-migration-enrollment.repository.ts";
import { MemorySystemMigrationStateRepository } from "../../../../repositories/memory/memory.system-migration-state.repository.ts";
import { SystemMigrationLegacyMirrorService } from "../system-migration-legacy-mirror.service.ts";

const ENGINE = "authz:engine";

function world() {
  const legacy = MemorySystemMigrationStateRepository.create();
  const enrolments = MemorySystemMigrationEnrollmentRepository.create();
  const mirror = SystemMigrationLegacyMirrorService.create({
    legacy,
    moves: { "authz-engine": ENGINE },
  });
  const state = mirror.state(MemoryTenantStepStateRepository.create());
  const legacyStatusOf = (tenantId: string) =>
    legacy.getRecord({ migrationName: "authz-engine", tenantId }).then(
      ({ status }) => status,
      () => null,
    );
  return { legacy, enrolments, mirror, state, legacyStatusOf };
}

describe("SystemMigrationLegacyMirrorService", () => {
  describe("when a moved step records a tenant", () => {
    /** @scenario "A rollback to the older release after a tenant finished on the new step keeps it on its new path" */
    it("writes finishes and rollbacks under the old name, never a held or parked tenant", async () => {
      const { state, legacyStatusOf } = world();
      const record = { migrationName: ENGINE, report: null };

      await state.upsertRecordUnlessRolledBack({
        ...record,
        tenantId: "acme",
        status: "finalized",
      });
      await state.upsertRecordUnlessRolledBack({ ...record, tenantId: "held", status: "migrated" });
      await state.upsertRecordUnlessRolledBack({ ...record, tenantId: "broke", status: "parked" });
      await state.upsertRecord({ ...record, tenantId: "pulled", status: "rolled_back" });

      expect(await legacyStatusOf("acme")).toBe("finalized");
      expect(await legacyStatusOf("held")).toBeNull();
      expect(await legacyStatusOf("broke")).toBeNull();
      expect(await legacyStatusOf("pulled")).toBe("rolled_back");
    });

    it("never replaces a rollback an operator made on the older page", async () => {
      const { legacy, state, legacyStatusOf } = world();
      await legacy.upsertRecord({
        migrationName: "authz-engine",
        tenantId: "acme",
        status: "rolled_back",
        report: null,
      });

      await state.upsertRecordUnlessRolledBack({
        migrationName: ENGINE,
        tenantId: "acme",
        status: "finalized",
        report: null,
      });

      expect(await legacyStatusOf("acme")).toBe("rolled_back");
    });

    it("leaves the older table alone for a step that never lived there", async () => {
      const { state, legacy } = world();

      await state.upsertRecord({
        migrationName: "automation:import-slack-connections",
        tenantId: "acme",
        status: "finalized",
        report: null,
      });

      await expect(
        legacy.findRecordsByStatus({ statuses: ["finalized"], limit: 10 }),
      ).resolves.toEqual([]);
    });
  });

  describe("when the migrations page enrols and withdraws", () => {
    /** @scenario "A withdrawal made on the older page during the rollout is withdrawn on the new step by the re-copy" */
    it("writes both names, and withdraws one the older page already withdrew", async () => {
      const { mirror, enrolments } = world();
      const page = mirror.enrollments(enrolments);
      const enrolled = async () =>
        (await enrolments.findAll()).map(({ organizationId, migrationName }) =>
          [organizationId, migrationName].join(" "),
        );

      await page.create({ organizationId: "acme", migrationName: ENGINE, enrolledByUserId: "op" });
      await page.createMany({
        organizationIds: ["beta"],
        migrationName: ENGINE,
        enrolledByUserId: "op",
      });
      expect((await enrolled()).toSorted()).toEqual([
        "acme authz-engine",
        "acme authz:engine",
        "beta authz-engine",
        "beta authz:engine",
      ]);

      await enrolments.delete({ organizationId: "beta", migrationName: "authz-engine" });
      await page.delete({ organizationId: "beta", migrationName: ENGINE });
      await page.delete({ organizationId: "acme", migrationName: ENGINE });

      expect(await enrolled()).toEqual([]);
    });
  });
});

/** @see modules/ops/specs/ops-system-migrations.feature */
import { MemoryTenantStepStateRepository } from "@langwatch/upgrade/step/tenant-state";
import { describe, expect, it } from "vitest";

import { MemoryOpsMigrationRepository } from "../memory/memory.ops-migration.repository.ts";
import { MemorySystemMigrationEnrollmentRepository } from "../memory/memory.system-migration-enrollment.repository.ts";
import { MemorySystemMigrationStateRepository } from "../memory/memory.system-migration-state.repository.ts";

const LEGACY = "automations-slack-connections";
const STEP = "automation:import-slack-connections";

async function world() {
  const legacy = MemorySystemMigrationStateRepository.create();
  const steps = MemoryTenantStepStateRepository.create();
  await legacy.upsertRecord({
    migrationName: LEGACY,
    tenantId: "acme",
    status: "finalized",
    report: { linked: 0 },
  });
  await legacy.upsertRecord({
    migrationName: LEGACY,
    tenantId: "beta",
    status: "rolled_back",
    report: null,
  });
  await legacy.upsertRecord({
    migrationName: LEGACY,
    tenantId: "gamma",
    status: "migrated",
    report: null,
  });
  const enrolments = MemorySystemMigrationEnrollmentRepository.create();
  await enrolments.createMany({
    organizationIds: ["acme", "delta"],
    migrationName: LEGACY,
    enrolledByUserId: "operator",
  });
  await enrolments.create({ organizationId: "delta", migrationName: STEP, enrolledByUserId: "op" });
  const copy = MemoryOpsMigrationRepository.create({ legacy, steps, enrolments });
  const run = (dryRun: boolean) => copy.copyTenantState({ moves: { [LEGACY]: STEP }, dryRun });
  const enrol = (dryRun: boolean) => copy.copyEnrolments({ moves: { [LEGACY]: STEP }, dryRun });
  const enrolledUnder = async (migrationName: string) =>
    (await enrolments.findAll())
      .filter((enrolment) => enrolment.migrationName === migrationName)
      .map(({ organizationId }) => organizationId)
      .toSorted();
  const stateOf = (tenantId: string) =>
    steps.getRecord({ migrationName: STEP, tenantId }).then(
      ({ status }) => status,
      () => null,
    );
  return { legacy, run, stateOf, enrol, enrolledUnder };
}

describe("copying an ops-held migration's state to its owner's step", () => {
  /** @scenario "An organization that finished an ops-held migration does not run it again after its owner declares it" */
  it("carries finalized and rolled-back tenants, leaves held ones to re-run, keeps the source", async () => {
    const { legacy, run, stateOf } = await world();

    expect(await run(false)).toBe(2);

    expect(await stateOf("acme")).toBe("finalized");
    expect(await stateOf("beta")).toBe("rolled_back");
    expect(await stateOf("gamma")).toBeNull();
    expect(legacy.recordsOf({ migrationName: LEGACY })).toHaveLength(3);
    expect(await run(false)).toBe(0);
  });

  it("writes nothing on a dry run", async () => {
    const { run, stateOf } = await world();

    expect(await run(true)).toBe(2);
    expect(await stateOf("acme")).toBeNull();
  });

  /** @scenario "An organization enrolled in an ops-held migration stays enrolled after its owner declares it" */
  it("copies enrolments to the step id, keeps the legacy ones and copies nothing twice", async () => {
    const { enrol, enrolledUnder } = await world();

    expect(await enrol(false)).toBe(1);

    expect(await enrolledUnder(STEP)).toEqual(["acme", "delta"]);
    expect(await enrolledUnder(LEGACY)).toEqual(["acme", "delta"]);
    expect(await enrol(false)).toBe(0);
  });

  it("enrols nobody on a dry run", async () => {
    const { enrol, enrolledUnder } = await world();

    expect(await enrol(true)).toBe(1);
    expect(await enrolledUnder(STEP)).toEqual(["delta"]);
  });
});

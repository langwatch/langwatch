// Spec: packages/upgrade/specs/tenant-step-settle.feature
import { describe, expect, it } from "vitest";

import { MemoryTenantStepStateRepository } from "../memory.tenant-state.repository.ts";

describe("the tenant step state's operator readers", () => {
  /** @scenario "Ops reads a tenant step's counts and attention rows from the framework's table" */
  it("counts each status and lists the tenants needing attention for one step", async () => {
    const state = MemoryTenantStepStateRepository.create();
    await state.upsertRecord({
      migrationName: "authz:engine",
      tenantId: "org-1",
      status: "finalized",
      report: null,
    });
    await state.upsertRecord({
      migrationName: "authz:engine",
      tenantId: "org-2",
      status: "parked",
      report: { error: "x" },
    });
    await state.upsertRecord({
      migrationName: "identity:secret-heal",
      tenantId: "user-1",
      status: "migrated",
      report: null,
    });

    await expect(state.findStatusCounts({ migrationName: "authz:engine" })).resolves.toEqual({
      migrated: 0,
      finalized: 1,
      parked: 1,
      rolled_back: 0,
    });
    const attention = await state.findRecordsByStatus({
      migrationName: "authz:engine",
      statuses: ["parked", "migrated"],
      limit: 10,
    });
    expect(attention.map((row) => row.tenantId)).toEqual(["org-2"]);
    await expect(
      state.hasTenantAwaitingRedrive({ migrationNames: ["identity:secret-heal"] }),
    ).resolves.toBe(true);
  });
});

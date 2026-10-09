import { SystemMigrationRunnerService, type TenantSource } from "@langwatch/system-migrations";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { defineMigrationStep, isMigrationStep, isTenantMigrationStep } from "../migration-step.ts";
import { MemoryTenantStepStateRepository } from "../tenant-state/index.ts";

const NOW = Temporal.Instant.from("2026-10-09T00:00:00Z");
const noReport = async () => ({});

function seedTags({ held }: { held: string }) {
  const visits: string[] = [];
  const step = defineMigrationStep({
    id: "prompt:seed-default-tags",
    kind: "tenant",
    mode: "background",
    description: "Seeds the default prompt tags into every organization.",
    tenants: "organization",
    title: "Default prompt tags",
    requiresOperatorConfirmation: false,
    runsAutomaticallyOnSelfHosted: true,
    enrolledAutomatically: true,
    migrateTenant: async ({ tenantId }) => {
      visits.push(tenantId);
      return tenantId === held
        ? { status: "migrated", report: { waiting: 1 }, heldReason: "pending" }
        : { status: "finalized" };
    },
  });
  return { step, visits };
}

/** Pages the ids in order, `limit` at a time, as the framework's paged source does. */
function pagedTenants({ count }: { count: number }): TenantSource & { pages: number } {
  const ids = Array.from({ length: count }, (_, index) => `org-${String(index).padStart(4, "0")}`);
  const source = {
    pages: 0,
    findTenantIdsAfter: async ({ cursor, limit }: { cursor: string | null; limit: number }) => {
      source.pages += 1;
      const start = cursor === null ? 0 : ids.indexOf(cursor) + 1;
      return ids.slice(start, start + limit);
    },
  };
  return source;
}

function runnerOver({
  step,
  tenants,
  state,
}: {
  step: ReturnType<typeof seedTags>["step"];
  tenants: TenantSource;
  state: MemoryTenantStepStateRepository;
}) {
  return new SystemMigrationRunnerService({
    state,
    tenants,
    lease: { acquire: async () => true, renew: async () => true, release: async () => {} },
    cohort: () => true,
    migrations: [{ ...step, name: step.id }],
    now: () => NOW,
  });
}

describe("a tenant step", () => {
  it("carries its pacing flat and migrates one tenant at a time", () => {
    const { step } = seedTags({ held: "none" });

    expect(isTenantMigrationStep(step)).toBe(true);
    expect(isMigrationStep(step)).toBe(false);
    expect(step.tenants).toBe("organization");
    expect(step.title).toBe("Default prompt tags");
  });

  it("refuses tenant pacing on any other kind, by type", () => {
    const data = defineMigrationStep({
      id: "prompt:fill-column",
      kind: "data",
      mode: "background",
      description: "Fills a column.",
      // @ts-expect-error a data step has no tenant pacing (S6-4)
      title: "Fill",
      run: noReport,
    });

    expect(isMigrationStep(data)).toBe(true);
    expect(isTenantMigrationStep(data)).toBe(false);
  });

  describe("when a pass walks more tenants than one page holds", () => {
    it("visits every tenant once and keeps each tenant's state in the framework's table", async () => {
      const { step, visits } = seedTags({ held: "org-0007" });
      const tenants = pagedTenants({ count: 260 });
      const state = MemoryTenantStepStateRepository.create();

      await runnerOver({ step, tenants, state }).runPass({});

      expect(tenants.pages).toBeGreaterThan(1);
      expect(new Set(visits).size).toBe(260);
      expect(visits).toHaveLength(260);
      const held = await state.getRecord({ migrationName: step.id, tenantId: "org-0007" });
      expect(held).toMatchObject({ status: "migrated", heldReason: "pending" });
      const done = await state.getRecord({ migrationName: step.id, tenantId: "org-0001" });
      expect(done.status).toBe("finalized");
    });
  });

  describe("when a second pass runs", () => {
    it("re-runs only the held tenant and never a finalized or rolled-back one", async () => {
      const { step, visits } = seedTags({ held: "org-0001" });
      const tenants = pagedTenants({ count: 3 });
      const state = MemoryTenantStepStateRepository.create();
      await state.upsertRecord({
        migrationName: step.id,
        tenantId: "org-0002",
        status: "rolled_back",
        report: null,
      });

      await runnerOver({ step, tenants, state }).runPass({});
      visits.length = 0;
      await runnerOver({ step, tenants, state }).runPass({});

      expect(visits).toEqual(["org-0001"]);
      const pinned = await state.getRecord({ migrationName: step.id, tenantId: "org-0002" });
      expect(pinned.status).toBe("rolled_back");
    });
  });
});

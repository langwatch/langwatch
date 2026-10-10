/**
 * @vitest-environment node
 * @see packages/upgrade/specs/tenant-step-settle.feature
 * Requires LANGWATCH_TEST_DATABASE_URL; the test gets its own Postgres schema.
 */

import { SystemMigrationRunnerService } from "@langwatch/system-migrations";
import { Temporal } from "@langwatch/time";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createLedgerTables } from "../../../ledger-tables.ts";
import { UpgradeRunnerRepository } from "../../../runner/runner-ledger.repository.ts";
import { TenantStepStateRepository } from "../tenant-state.repository.ts";
import { TenantStepSettleService } from "../tenant-step-settle.service.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;
const PENDING = "prompt:seed-default-tags";
const FAILED = "prompt:seed-default-labels";

describe.skipIf(!DB_URL)("TenantStepSettleService over Postgres", () => {
  const name = `tenant_settle_${Date.now().toString(36)}`;
  let admin: Pool;
  let postgres: Pool;

  beforeEach(async () => {
    admin = new Pool({ connectionString: DB_URL, max: 1 });
    await admin.query(`CREATE SCHEMA "${name}"`);
    postgres = new Pool({
      connectionString: DB_URL,
      max: 2,
      options: `-c search_path=${name},${name}_upgrade_ledger`,
    });
  });

  afterEach(async () => {
    await postgres.end();
    await admin.query(`DROP SCHEMA IF EXISTS "${name}_upgrade_ledger", "${name}" CASCADE`);
    await admin.end();
  });

  async function statusOf({ id }: { id: string }): Promise<string | undefined> {
    const tables = await createLedgerTables({ postgres });
    const { rows } = await postgres.query<{ status: string }>(
      `SELECT "status" FROM ${tables.step} WHERE "id" = $1`,
      [id],
    );
    return rows[0]?.status;
  }

  /** @scenario "Settling writes only a tenant step's pending or done row" */
  it("settles the pending row, leaves the failed one, and reopens on a held tenant", async () => {
    await createLedgerTables({ postgres });
    const ledger = UpgradeRunnerRepository.create({ postgres });
    const state = TenantStepStateRepository.create({ postgres });
    const step = { kind: "tenant" as const, mode: "background" as const, owner: "prompt" };
    await ledger.registerSteps({
      steps: [
        { ...step, id: PENDING, description: "Seeds tags.", release: null },
        { ...step, id: FAILED, description: "Seeds labels.", release: null },
      ],
    });
    await ledger.setStatus({ ids: [FAILED], status: "failed", runId: "run-1", lastError: "boom" });
    await state.upsertRecord({
      migrationName: PENDING,
      tenantId: "org-1",
      status: "finalized",
      report: null,
    });
    const service = TenantStepSettleService.create({ state, ledger });
    const runner = new SystemMigrationRunnerService({
      now: () => Temporal.Now.instant(),
      state,
      lease: { acquire: async () => false, renew: async () => false, release: async () => {} },
      tenants: { findTenantIdsAfter: async ({ cursor }) => (cursor ? [] : ["org-1"]) },
      cohort: () => true,
      migrations: [],
    });

    await service.settle({ buckets: [{ ids: [PENDING, FAILED], runner }] });
    expect(await statusOf({ id: PENDING })).toBe("done");
    expect(await statusOf({ id: FAILED })).toBe("failed");

    await state.upsertRecord({
      migrationName: PENDING,
      tenantId: "org-2",
      status: "migrated",
      report: null,
      heldReason: "proof",
    });
    await service.settle({ buckets: [{ ids: [PENDING], runner }] });
    expect(await statusOf({ id: PENDING })).toBe("pending");
  });
});

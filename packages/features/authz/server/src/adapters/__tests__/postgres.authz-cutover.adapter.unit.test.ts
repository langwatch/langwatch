import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AuthzCutoverFailureReporter,
  AUTHZ_ENGINE_MIGRATION_NAME,
  ENGINE_GATE_CACHE_TTL_MS,
  PostgresAuthzCutoverAdapter,
  type AuthzCutoverDatabase,
  type AuthzCutoverReadFailure,
} from "../postgres.authz-cutover.adapter";

const ORG_ID = "org_gate";

class RecordingReporter extends AuthzCutoverFailureReporter {
  readonly failures: AuthzCutoverReadFailure[] = [];

  report(failure: AuthzCutoverReadFailure): void {
    this.failures.push(failure);
  }
}

function stateTable(status: string | null) {
  const findUnique = vi.fn().mockResolvedValue(status === null ? null : { status });
  const reporter = new RecordingReporter();
  const adapter = PostgresAuthzCutoverAdapter.create({
    database: {
      systemMigrationTenantState: { findUnique },
    } as AuthzCutoverDatabase,
    reporter,
  });
  return { adapter, findUnique, reporter };
}

describe("PostgresAuthzCutoverAdapter", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks only for the canonical AuthZ migration", async () => {
    const { adapter, findUnique } = stateTable("finalized");

    await adapter.isOn({ organizationId: ORG_ID });

    expect(findUnique.mock.calls[0]![0].where).toEqual({
      migrationName_tenantId: {
        migrationName: AUTHZ_ENGINE_MIGRATION_NAME,
        tenantId: ORG_ID,
      },
    });
  });

  it.each([
    ["migrated", false],
    ["finalized", true],
    ["pending", false],
    ["parked", false],
    ["rolled_back", false],
    [null, false],
  ])("reads %s as on-ledger=%s", async (status, expected) => {
    const { adapter } = stateTable(status);
    await expect(adapter.isOn({ organizationId: ORG_ID })).resolves.toBe(expected);
  });

  it("reports a failed state read and fails safe to legacy", async () => {
    const error = new Error("pg is down");
    const reporter = new RecordingReporter();
    const adapter = PostgresAuthzCutoverAdapter.create({
      database: {
        systemMigrationTenantState: {
          findUnique: vi.fn().mockRejectedValue(error),
        },
      },
      reporter,
    });

    await expect(adapter.isOn({ organizationId: ORG_ID })).resolves.toBe(false);
    expect(reporter.failures).toEqual([
      { organizationId: ORG_ID, error, ttlMs: ENGINE_GATE_CACHE_TTL_MS },
    ]);
  });

  it("returns only the finalized cutover business time", async () => {
    const occurredAt = new Date("2026-08-18T09:00:00.000Z");
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce({ status: "finalized", occurredAt })
      .mockResolvedValueOnce({ status: "migrated", occurredAt });
    const adapter = PostgresAuthzCutoverAdapter.create({
      database: { systemMigrationTenantState: { findUnique } },
      reporter: new RecordingReporter(),
    });

    await expect(adapter.tryGetFinalizedAt({ organizationId: ORG_ID })).resolves.toEqual(
      occurredAt,
    );
    await expect(
      adapter.tryGetFinalizedAt({ organizationId: ORG_ID }),
    ).resolves.toBeNull();
  });

  it("raises through the uncached read used by revocation routing", async () => {
    const adapter = PostgresAuthzCutoverAdapter.create({
      database: {
        systemMigrationTenantState: {
          findUnique: vi.fn().mockRejectedValue(new Error("pg is down")),
        },
      },
      reporter: new RecordingReporter(),
    });

    await expect(adapter.readUncached({ organizationId: ORG_ID })).rejects.toThrow(
      "pg is down",
    );
  });

  it("coalesces repeated reads inside the cache window", async () => {
    const { adapter, findUnique } = stateTable("finalized");
    await adapter.isOn({ organizationId: ORG_ID });
    await adapter.isOn({ organizationId: ORG_ID });
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it("observes rollback after the cache TTL", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-18T09:00:00.000Z"));
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce({ status: "finalized" })
      .mockResolvedValue({ status: "rolled_back" });
    const adapter = PostgresAuthzCutoverAdapter.create({
      database: { systemMigrationTenantState: { findUnique } },
      reporter: new RecordingReporter(),
    });

    await expect(adapter.isOn({ organizationId: ORG_ID })).resolves.toBe(true);
    vi.setSystemTime(new Date("2026-08-18T09:05:00.000Z"));
    await expect(adapter.isOn({ organizationId: ORG_ID })).resolves.toBe(false);
  });
});

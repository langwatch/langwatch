import { createTestLogger } from "@langwatch/test-harness";
import { fromDate } from "@langwatch/time";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AUTHZ_ENGINE_MIGRATION_NAME } from "../../migrations/legacy-import.authz-grant.migration.ts";
import {
  type AuthzCutoverDatabase,
  PrismaAuthzCutoverRepository,
} from "../../repositories/prisma/prisma.authz-cutover.repository.ts";
import {
  AuthzCutoverGateService,
  ENGINE_GATE_CACHE_TTL_MS,
} from "../authz-cutover-gate.service.ts";

const ORG_ID = "org_gate";

function stateTable(status: string | null) {
  const findUnique = vi.fn().mockResolvedValue(status === null ? null : { status });
  const adapter = AuthzCutoverGateService.create({
    repository: PrismaAuthzCutoverRepository.create({
      database: { systemMigrationTenantState: { findUnique } } as AuthzCutoverDatabase,
    }),
  });
  return { adapter, findUnique };
}

describe("AuthzCutoverGateService", () => {
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

  /** @scenario "A cut-over organization is decided by the engine" */
  /** @scenario "An organization that has not cut over is unchanged" */
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

  /** @scenario "A failed migration-state read is reported" */
  it("reports a failed state read and fails safe to legacy", async () => {
    const error = new Error("pg is down");
    const { logger, lines } = createTestLogger();
    const adapter = AuthzCutoverGateService.create({
      repository: PrismaAuthzCutoverRepository.create({
        database: {
          systemMigrationTenantState: { findUnique: vi.fn().mockRejectedValue(error) },
        } as AuthzCutoverDatabase,
      }),
      logger,
    });

    await expect(adapter.isOn({ organizationId: ORG_ID })).resolves.toBe(false);
    expect(lines.findLine("warn", "could not read the authz migration state")).toMatchObject({
      organizationId: ORG_ID,
      ttlMs: ENGINE_GATE_CACHE_TTL_MS,
    });
  });

  it("returns only the finalized cutover business time", async () => {
    const occurredAt = new Date("2026-08-18T09:00:00.000Z");
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce({ status: "finalized", occurredAt })
      .mockResolvedValueOnce({ status: "migrated", occurredAt });
    const adapter = AuthzCutoverGateService.create({
      repository: PrismaAuthzCutoverRepository.create({
        database: { systemMigrationTenantState: { findUnique } } as AuthzCutoverDatabase,
      }),
    });

    await expect(adapter.findFinalizedAt({ organizationId: ORG_ID })).resolves.toEqual(
      fromDate(occurredAt),
    );
    await expect(adapter.findFinalizedAt({ organizationId: ORG_ID })).resolves.toBeNull();
  });

  it("raises through the uncached read used by revocation routing", async () => {
    const adapter = AuthzCutoverGateService.create({
      repository: PrismaAuthzCutoverRepository.create({
        database: {
          systemMigrationTenantState: {
            findUnique: vi.fn().mockRejectedValue(new Error("pg is down")),
          },
        } as AuthzCutoverDatabase,
      }),
    });

    await expect(adapter.readUncached({ organizationId: ORG_ID })).rejects.toThrow("pg is down");
  });

  it("coalesces repeated reads inside the cache window", async () => {
    const { adapter, findUnique } = stateTable("finalized");
    await adapter.isOn({ organizationId: ORG_ID });
    await adapter.isOn({ organizationId: ORG_ID });
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  /** @scenario "Rolling back returns an organization to the legacy path within the gate's cache window" */
  it("observes rollback after the cache TTL", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-18T09:00:00.000Z"));
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce({ status: "finalized" })
      .mockResolvedValue({ status: "rolled_back" });
    const adapter = AuthzCutoverGateService.create({
      repository: PrismaAuthzCutoverRepository.create({
        database: { systemMigrationTenantState: { findUnique } } as AuthzCutoverDatabase,
      }),
    });

    await expect(adapter.isOn({ organizationId: ORG_ID })).resolves.toBe(true);
    vi.setSystemTime(new Date("2026-08-18T09:05:00.000Z"));
    await expect(adapter.isOn({ organizationId: ORG_ID })).resolves.toBe(false);
  });
});

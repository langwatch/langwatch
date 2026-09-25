import { afterEach, describe, expect, it, vi } from "vitest";
import { IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME } from "../../identity/migration-name";
import { createIdentityMigrationFixture } from "./identity-migration.fixture";

const target = {
  userId: "new-sso-user",
  migrationName: IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME,
};
afterEach(() => {
  vi.useRealTimers();
});

describe("one-user identity adoption", () => {
  /** @scenario "An admitted SSO user is adopted without a fleet-wide migration pass" */
  it("waits for normal persisted finalization after projection becomes visible", async () => {
    vi.useFakeTimers();
    const fixture = createIdentityMigrationFixture();
    fixture.runTargetedPass.mockImplementationOnce(async () => {
      fixture.records.set(target.userId, {
        tenantId: target.userId,
        migrationName: target.migrationName,
        status: "migrated",
        report: { kind: "parity" },
      });
      return {
        tenantsSeen: 1,
        finalized: 0,
        held: 1,
        finiteHeld: 1,
        parked: 0,
        skipped: 0,
        alreadyFinalized: 0,
        alreadyRolledBack: 0,
        claimed: 0,
        advanced: 1,
      };
    });
    const result = fixture.service.runForUser(target);
    await vi.runAllTimersAsync();
    await expect(result).resolves.toEqual({ status: "finalized" });
    expect(fixture.runTargetedPass.mock.calls.map(([args]) => args)).toEqual([
      target,
      target,
    ]);
  });

  /** @scenario "Pending identity projection does not imply finalized adoption" */
  it("does not pretend that a held migration finalized", async () => {
    vi.useFakeTimers();
    const fixture = createIdentityMigrationFixture();
    fixture.runTargetedPass.mockImplementation(async () => {
      fixture.records.set(target.userId, {
        tenantId: target.userId,
        migrationName: target.migrationName,
        status: "migrated",
        report: { kind: "parity" },
      });
      return {
        tenantsSeen: 1,
        finalized: 0,
        held: 1,
        finiteHeld: 1,
        parked: 0,
        skipped: 0,
        alreadyFinalized: 0,
        alreadyRolledBack: 0,
        claimed: 0,
        advanced: 0,
      };
    });
    const result = fixture.service.runForUser(target);
    await vi.runAllTimersAsync();
    await expect(result).resolves.toEqual({ status: "migrated" });
    expect(fixture.records.get(target.userId)?.status).toBe("migrated");
    expect(fixture.runTargetedPass).toHaveBeenCalledTimes(20);
  });

  it("leaves an unenrolled user untouched", async () => {
    const fixture = createIdentityMigrationFixture();
    fixture.runTargetedPass.mockResolvedValue({
      tenantsSeen: 1,
      finalized: 0,
      held: 0,
      finiteHeld: 0,
      parked: 0,
      skipped: 1,
      alreadyFinalized: 0,
      alreadyRolledBack: 0,
      claimed: 0,
      advanced: 0,
    });
    await expect(fixture.service.runForUser(target)).resolves.toEqual({
      status: null,
    });
    expect(fixture.records.size).toBe(0);
    expect(fixture.runTargetedPass).toHaveBeenCalledOnce();
  });

  for (const status of ["finalized", "rolled_back"] as const) {
    it(`leaves persisted ${status} state unchanged`, async () => {
      const fixture = createIdentityMigrationFixture();
      fixture.records.set(target.userId, {
        tenantId: target.userId,
        migrationName: target.migrationName,
        status,
        report: null,
      });
      await expect(fixture.service.runForUser(target)).resolves.toEqual({
        status,
      });
      expect(fixture.runTargetedPass).not.toHaveBeenCalled();
    });
  }
});

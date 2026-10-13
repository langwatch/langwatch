// Spec: modules/identity/specs/sign-in-switch.feature
import { describe, expect, it, vi } from "vitest";

import { MemoryIdentityLatchRepository } from "../../repositories/memory/memory.identity-latch.repository.ts";
import { MemoryIdentityStore } from "../../repositories/memory/memory.identity.store.ts";
import type { IdentityBackfillOutcome } from "../identity-backfill.service.ts";
import { IdentitySignInSwitchService } from "../identity-sign-in-switch.service.ts";
import { IdentityIdentifierBackfillMigrationService } from "../system-migration-identity-identifier-backfill.service.ts";

const USER_ID = "user_sam";

function backfillOver({
  store,
  outcome,
}: {
  store: MemoryIdentityStore;
  outcome: "finalized" | "migrated";
}) {
  const migrateUser = vi.fn(async (): Promise<IdentityBackfillOutcome> =>
    outcome === "finalized"
      ? { status: "finalized", report: { kind: "no_email" } }
      : { status: "migrated", report: { kind: "parity", diffs: [] } },
  );
  const migration = IdentityIdentifierBackfillMigrationService.create({
    backfill: { migrateUser },
    latch: MemoryIdentityLatchRepository.create(store),
    maxQueuedJobs: 5_000,
  });
  return { migration, migrateUser };
}

describe("the identifier backfill and identity's sign-in switch", () => {
  /** @scenario "Proving a user's identifier backfill turns identity's switch on" */
  it("turns the switch on as it finalizes a user", async () => {
    const store = MemoryIdentityStore.create();
    const { migration } = backfillOver({ store, outcome: "finalized" });

    await expect(migration.migrateTenant({ tenantId: USER_ID })).resolves.toMatchObject({
      status: "finalized",
    });
    expect(store.finalizedUsers.has(USER_ID)).toBe(true);
  });

  /** @scenario "A user already on the identifier path finalizes at once" */
  it("answers finalized at once for a user already on the identifier path", async () => {
    const store = MemoryIdentityStore.create();
    store.finalizedUsers.add(USER_ID);
    const { migration, migrateUser } = backfillOver({ store, outcome: "migrated" });

    await expect(migration.migrateTenant({ tenantId: USER_ID })).resolves.toMatchObject({
      status: "finalized",
    });
    expect(migrateUser).not.toHaveBeenCalled();
  });

  /** @scenario "A user pinned off while the backfill ran stays held" */
  it("keeps a pinned user held and off the identifier path", async () => {
    const store = MemoryIdentityStore.create();
    store.pinnedUsers.add(USER_ID);
    const { migration } = backfillOver({ store, outcome: "finalized" });

    await expect(migration.migrateTenant({ tenantId: USER_ID })).resolves.toMatchObject({
      status: "migrated",
    });
    expect(store.finalizedUsers.has(USER_ID)).toBe(false);
  });

  /** @scenario "An operator's rollback pins identity's sign-in switch off" */
  it("pins the user off on the backfill's rollback and ignores another step's", async () => {
    const store = MemoryIdentityStore.create();
    store.finalizedUsers.add(USER_ID);
    const service = IdentitySignInSwitchService.create({
      latch: MemoryIdentityLatchRepository.create(store),
    });
    const fact = { rolledBackTenantId: USER_ID, actorUserId: "user_operator" };

    await service.rolledBack({
      fact: { ...fact, stepId: "authz:engine" },
      eventId: "event-1",
      occurredAt: 1,
    });
    expect(store.finalizedUsers.has(USER_ID)).toBe(true);

    await service.rolledBack({
      fact: { ...fact, stepId: "identity:identifier-backfill" },
      eventId: "event-2",
      occurredAt: 2,
    });
    expect(store.pinnedUsers.has(USER_ID)).toBe(true);
    expect(store.finalizedUsers.has(USER_ID)).toBe(false);
  });
});

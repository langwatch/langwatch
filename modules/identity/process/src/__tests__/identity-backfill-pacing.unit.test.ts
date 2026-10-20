import {
  type MigrationLeaseRepository,
  SystemMigrationRecordNotFoundError,
  type SystemMigrationRunnerDeps,
  SystemMigrationRunnerService,
  type SystemMigrationStateRepository,
  type TenantMigrationRecord,
} from "@langwatch/system-migrations";
import { nowInstant } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryIdentityLatchRepository } from "../repositories/memory/memory.identity-latch.repository.ts";
import { MemoryIdentityStore } from "../repositories/memory/memory.identity.store.ts";
import { IdentityIdentifierBackfillMigrationService } from "../services/system-migration-identity-identifier-backfill.service.ts";

const LIMIT = 5_000;
const USERS = 250;

class MapState implements SystemMigrationStateRepository {
  readonly records = new Map<string, TenantMigrationRecord>();

  async getRecord({ migrationName, tenantId }: { migrationName: string; tenantId: string }) {
    const record = this.records.get(`${migrationName}:${tenantId}`);
    if (!record) throw new SystemMigrationRecordNotFoundError({ migrationName, tenantId });
    return record;
  }

  async findRecords({ tenantIds }: { tenantIds: readonly string[] }) {
    return [...this.records.values()].filter((record) => tenantIds.includes(record.tenantId));
  }

  async upsertRecord(record: TenantMigrationRecord) {
    this.records.set(`${record.migrationName}:${record.tenantId}`, record);
  }

  async upsertRecordUnlessRolledBack(record: TenantMigrationRecord) {
    await this.upsertRecord(record);
    return true;
  }

  async hasFinalizedTenant() {
    return false;
  }
}

const freeLease: MigrationLeaseRepository = {
  acquire: async () => true,
  renew: async () => true,
  release: async () => undefined,
};

/** A worker queue that drains `drainPerRead` jobs each time it is read; each user queues two. */
function slowQueue({ waiting, drainPerRead }: { waiting: number; drainPerRead: number }) {
  const queue = { waiting, reads: [] as number[], failuresLeft: 0 };
  const read = async (): Promise<number> => {
    if (queue.failuresLeft > 0) {
      queue.failuresLeft -= 1;
      throw new Error("redis unavailable");
    }
    queue.reads.push(queue.waiting);
    const seen = queue.waiting;
    queue.waiting = Math.max(0, queue.waiting - drainPerRead);
    return seen;
  };
  return { queue, read };
}

function pass({
  read,
  runListedWork,
}: {
  read: () => Promise<number>;
  runListedWork?: SystemMigrationRunnerDeps["runListedWork"];
}) {
  const userIds = Array.from({ length: USERS }, (_, n) => `user_${String(n).padStart(4, "0")}`);
  const migrated: { userId: string; lastRead: number | undefined }[] = [];
  const lastRead = { value: undefined as number | undefined };
  const runner = new SystemMigrationRunnerService({
    now: nowInstant,
    state: new MapState(),
    lease: freeLease,
    tenants: {
      findTenantIdsAfter: async ({ cursor, limit }) => {
        const from = cursor === null ? 0 : userIds.indexOf(cursor) + 1;
        return userIds.slice(from, from + limit);
      },
    },
    cohort: () => true,
    migrations: [
      IdentityIdentifierBackfillMigrationService.create({
        latch: MemoryIdentityLatchRepository.create(MemoryIdentityStore.create()),
        backfill: {
          migrateUser: async ({ userId }) => {
            migrated.push({ userId, lastRead: lastRead.value });
            return { status: "finalized", report: { kind: "no_email" } };
          },
        },
        maxQueuedJobs: LIMIT,
      }),
    ],
    queuedJobs: async () => {
      lastRead.value = await read();
      return lastRead.value;
    },
    pacingWaitMs: 1,
    ...(runListedWork ? { runListedWork } : {}),
  });
  return { runner, migrated };
}

describe("the identifier backfill's pacing", () => {
  /** @scenario "The identifier backfill holds while the queue is over its limit and resumes as it drains" */
  it("queues no user while the waiting count is over the limit, and carries on once it drains", async () => {
    const { queue, read } = slowQueue({ waiting: 8_000, drainPerRead: 1_000 });
    const { runner, migrated } = pass({ read });

    await runner.runPass();

    // 8,000 -> 7,000 -> 6,000 -> 5,000: three reads over the limit held the first page.
    expect(queue.reads.slice(0, 4)).toEqual([8_000, 7_000, 6_000, 5_000]);
    expect(migrated).toHaveLength(USERS);
    expect(migrated.every((user) => (user.lastRead ?? Infinity) <= LIMIT)).toBe(true);
  });

  /** @scenario "An unreadable queue holds the identifier backfill rather than reading as empty" */
  it("waits while the depth cannot be read, and starts only after a read under the limit", async () => {
    const { queue, read } = slowQueue({ waiting: 0, drainPerRead: 0 });
    queue.failuresLeft = 3;
    const { runner, migrated } = pass({ read });

    await runner.runPass();

    expect(queue.failuresLeft).toBe(0);
    expect(migrated).toHaveLength(USERS);
    expect(migrated[0]?.lastRead).toBe(0);
  });

  it("an aborted pass stops holding and queues nothing", async () => {
    const { read } = slowQueue({ waiting: 1_000_000, drainPerRead: 0 });
    const { runner, migrated } = pass({ read });
    const abort = new AbortController();
    setTimeout(() => abort.abort(), 20);

    await runner.runPass({ signal: abort.signal });

    expect(migrated).toHaveLength(0);
  });

  /** @scenario "A large unrelated backlog does not hold the identifier backfill" */
  it("on its own queue list, waits only for its own jobs, whatever the whole queue holds", async () => {
    const { queue, read } = slowQueue({ waiting: 1_000_000, drainPerRead: 0 });
    const rooms: number[] = [];
    const { runner, migrated } = pass({
      read,
      runListedWork: async ({ work }) =>
        work({ waitForRoom: async ({ maxOutstanding }) => void rooms.push(maxOutstanding) }),
    });

    await runner.runPass();

    expect(migrated).toHaveLength(USERS);
    expect(queue.reads).toEqual([]);
    expect(rooms.length).toBeGreaterThan(0);
    expect(rooms.every((room) => room === LIMIT)).toBe(true);
  });
});

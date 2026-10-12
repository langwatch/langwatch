import type {
  ProjectionStoreContext,
  StateProjectionStore,
  StoredProjection,
  StoredProjectionRead,
} from "@langwatch/eventing";
import {
  type AttachIdentifierCommandData,
  type IdentifierFact,
  normalizeIdentifierValue,
  type VerifyIdentifierCommandData,
} from "@langwatch/identity-contract";
import { UserNotFoundError } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import { IdentityLedgerStore } from "../eventing/identity-ledger.store.ts";
import type { IdentityFoldState } from "../eventing/identity-state.projection.ts";
import type { BackfillUserRow } from "../repositories/identity-backfill.repository.ts";
import { CryptoIdentifierIdentityService } from "../services/crypto-identifier-identity.service.ts";
import { IdentityBackfillPlanService } from "../services/identity-backfill-plan.service.ts";
import { IdentityBackfillService } from "../services/identity-backfill.service.ts";
import { IdentityGuardsService } from "../services/identity-guards.service.ts";
import { IdentitySecretCarryService } from "../services/identity-secret-carry.service.ts";
import { IdentityService } from "../services/identity.service.ts";
import {
  inMemoryIdentityReservations,
  inMemoryIdentityUsers,
} from "./support/identity-memory-repositories.ts";
import { InMemoryHeads } from "./support/in-memory-heads.ts";

const USERS = 1_000;
const CREATED_AT = Date.UTC(2023, 2, 14, 9, 30);

type Staged =
  | { name: "attachIdentifier"; data: AttachIdentifierCommandData }
  | { name: "verifyIdentifier"; data: VerifyIdentifierCommandData };

/** The projection the ledger would poll; every read is counted, none is ever answered. */
class CountingProjectionStore implements StateProjectionStore<IdentityFoldState> {
  reads = 0;

  constructor(private readonly heads: InMemoryHeads) {}

  async get(
    _key: string,
    _context: ProjectionStoreContext,
  ): Promise<StoredProjectionRead<IdentityFoldState>> {
    this.reads += 1;
    return { kind: "empty" };
  }

  async store(_projection: StoredProjection<IdentityFoldState>): Promise<void> {}

  async writeProvisionalHeads({ facts }: { facts: IdentifierFact[] }): Promise<void> {
    for (const fact of facts) {
      const current = await this.heads.findHeads({ userId: fact.userId });
      current.identifiers[fact.identifierId] = fact;
      this.heads.heads.set(fact.userId, current);
    }
  }
}

/**
 * A fleet of users with a verified address and no account rows, behind the real guards and a
 * queue that does not drain until the test says so, as on a backed-up worker.
 */
function fleet({ convergence }: { convergence: { timeoutMs: number; pollMs: number } | null }) {
  const people = new Map<string, BackfillUserRow>();
  const emails: Record<string, string> = {};
  for (let n = 0; n < USERS; n += 1) {
    const id = `user_${String(n).padStart(4, "0")}`;
    const email = `member${n}@acme.com`;
    emails[id] = email;
    people.set(id, {
      id,
      email,
      emailVerified: true,
      createdAtMs: CREATED_AT,
      userHashKey: "a-hash-key",
      lastLoginAtMs: null,
      passkeySignupPending: false,
    });
  }

  const heads = new InMemoryHeads();
  for (const id of people.keys()) heads.newborns.add(id);
  const projection = new CountingProjectionStore(heads);
  const guards = IdentityGuardsService.create({
    heads,
    users: inMemoryIdentityUsers({ emails }),
    reservations: inMemoryIdentityReservations(),
    identifiers: CryptoIdentifierIdentityService.create(),
  });

  const queue: Staged[] = [];
  const ledger = IdentityLedgerStore.create({
    projectionStore: projection,
    heads,
    eventing: {
      resolvePipelineCommand: () => {
        throw new Error("the staged sender is supplied directly in this suite");
      },
    },
    stagedSender: async (name) => ({
      send: async (data: unknown) => {
        queue.push({ name, data } as Staged);
      },
    }),
    convergence,
  });

  const backfill = IdentityBackfillService.create({
    reads: {
      getUser: async ({ userId }) => {
        const found = people.get(userId);
        if (!found) throw new UserNotFoundError(userId);
        return found;
      },
      findAccountRows: async () => [],
      countPasskeys: async () => 0,
      findAddressSharers: async ({ normalizedValue }) =>
        [...people.values()].filter(
          (person) =>
            person.email !== null && normalizeIdentifierValue(person.email) === normalizedValue,
        ),
      findAddressLockHolders: async () => [],
      findIdentifierRows: async ({ userId }) =>
        Object.values((await heads.findHeads({ userId })).identifiers).map((head) => ({
          id: head.identifierId,
          provider: head.provider,
          value: head.value,
          accountId: head.accountId,
          state: head.state,
        })),
    },
    users: inMemoryIdentityUsers({ emails }),
    identity: IdentityService.create(guards, ledger),
    secrets: IdentitySecretCarryService.create({
      findDriftedUserIdsAfter: async () => [],
      findAccountSecretPairs: async () => [],
      insertCredentialIfMissing: async () => true,
      overwriteCredential: async () => undefined,
      deleteCredentials: async ({ accountIds }) => accountIds.length,
    }),
    plan: IdentityBackfillPlanService.create(CryptoIdentifierIdentityService.create()),
    userApi: {
      updateEmail: async () => {
        throw new Error("no address is shared in this fleet");
      },
    },
    auditLog: {
      record: async () => {
        throw new Error("no address is shared in this fleet");
      },
    },
  });

  /** The worker catching up: each staged command re-runs its guard and folds, in order. */
  const drain = async (): Promise<void> => {
    for (const job of queue.splice(0)) {
      const facts =
        job.name === "attachIdentifier"
          ? await guards.attachIdentifier(job.data)
          : await guards.verifyIdentifier(job.data);
      heads.fold(job.data.userId, facts);
      heads.newborns.delete(job.data.userId);
    }
  };

  const migrateEveryone = async () => {
    const outcomes = [];
    for (const userId of people.keys()) outcomes.push(await backfill.migrateUser({ userId }));
    return outcomes;
  };

  return { projection, queue, drain, migrateEveryone };
}

describe("the identifier backfill at fleet scale", () => {
  /** @scenario "The identifier backfill stages each user's commands without waiting for the fold" */
  it("stages every user's commands once and never polls the projection", async () => {
    const { projection, queue, drain, migrateEveryone } = fleet({ convergence: null });

    const first = await migrateEveryone();

    // One staged command per planned write (attach, then verify), each one queued job and one
    // event-log append; not a single projection read spent waiting for the fold.
    expect(projection.reads).toBe(0);
    expect(queue).toHaveLength(USERS * 2);
    expect(first.every((outcome) => outcome.status !== "finalized")).toBe(true);

    await drain();
    const second = await migrateEveryone();

    // The level-triggered next pass proves what the queue folded and states nothing again.
    expect(queue).toHaveLength(0);
    expect(projection.reads).toBe(0);
    expect(second.every((outcome) => outcome.status === "finalized")).toBe(true);
  });

  it("a ceremony's ledger, by contrast, polls the projection for every command it stages", async () => {
    const { projection, migrateEveryone } = fleet({ convergence: { timeoutMs: 1, pollMs: 1 } });

    await migrateEveryone();

    expect(projection.reads).toBeGreaterThanOrEqual(USERS * 2);
  });
});

/**
 * @vitest-environment node
 *
 * Every account mint commits user's created fact to its fact outbox with the row, and the
 * `user:record-created-facts` step records it for accounts minted before the fact existed.
 * @see modules/user/specs/user.feature
 */
import {
  createTenantId,
  type EventReadSeat,
  EventUtils,
  InMemoryProcessStore,
} from "@langwatch/eventing";
import {
  USER_AGGREGATE_TYPE,
  USER_DEACTIVATED_EVENT_TYPE,
  USER_LIFECYCLE_EVENT_VERSION,
  USER_REACTIVATED_EVENT_TYPE,
} from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import type {
  RecordUserLifecycleCommandData,
  UserDeactivatedEvent,
  UserReactivatedEvent,
} from "../../eventing/user-lifecycle.events.ts";
import { EventingUserStandingRepository } from "../../repositories/eventing/eventing.user-standing.repository.ts";
import { MemoryUserDatabase } from "../../repositories/memory/memory.user.database.ts";
import {
  MemoryUserRepositories,
  memoryUserRepositoriesOver,
} from "../../repositories/memory/memory.user.repositories.ts";
import type { UserLifecycleSenders } from "../../services/user-lifecycle-notice.service.ts";
import { createUserTestApp, createUserTestLifecycle, userFactsIn } from "./user.fixture.ts";

const never = new AbortController().signal;
const SYSTEM = { type: "system", id: null } as const;

type FactType = "created" | "deactivated" | "reactivated";
type LoggedFact = { type: FactType; data: RecordUserLifecycleCommandData };

function standingEventOf({ type, data }: LoggedFact): UserDeactivatedEvent | UserReactivatedEvent {
  const fields = {
    aggregateType: USER_AGGREGATE_TYPE,
    aggregateId: data.userId,
    tenantId: createTenantId(data.userId),
    version: USER_LIFECYCLE_EVENT_VERSION,
    data,
    metadata: {},
    occurredAt: data.occurredAt,
  };
  return type === "deactivated"
    ? EventUtils.createEvent<UserDeactivatedEvent>({ ...fields, type: USER_DEACTIVATED_EVENT_TYPE })
    : EventUtils.createEvent<UserReactivatedEvent>({
        ...fields,
        type: USER_REACTIVATED_EVENT_TYPE,
      });
}

/** user_lifecycle as a log keyed like its commands, noting each batch as it was sent. */
function lifecycleLog() {
  const { senders } = createUserTestLifecycle();
  const facts: LoggedFact[] = [];
  const batches: { type: FactType; userIds: string[] }[] = [];
  const append = (type: FactType) => {
    const send = async (data: RecordUserLifecycleCommandData) => {
      const known = facts.some(
        (fact) =>
          fact.type === type &&
          fact.data.userId === data.userId &&
          fact.data.occurredAt === data.occurredAt,
      );
      if (!known) facts.push({ type, data });
    };
    return {
      send,
      sendBatch: async (batch: RecordUserLifecycleCommandData[]) => {
        batches.push({ type, userIds: batch.map(({ userId }) => userId) });
        for (const data of batch) await send(data);
      },
    };
  };
  const logged: UserLifecycleSenders = {
    ...senders,
    recordUserCreated: append("created"),
    recordUserDeactivated: append("deactivated"),
    recordUserReactivated: append("reactivated"),
  };
  const reads: { aggregateIds: string[] }[] = [];
  const eventReadSeat: Pick<EventReadSeat, "findEventsOfAggregates"> = {
    findEventsOfAggregates: async ({ aggregates }) => {
      reads.push({ aggregateIds: aggregates.map(({ aggregateId }) => aggregateId) });
      return aggregates.flatMap(({ tenantId, aggregateId }) =>
        facts
          .filter(
            ({ type, data }) =>
              type !== "created" && data.userId === aggregateId && data.tenantId === tenantId,
          )
          .map(standingEventOf),
      );
    },
  };
  return { senders: logged, facts, batches, eventReadSeat, reads };
}

/** An app over a memory store whose fact outbox the test reads, its bus optionally down. */
function appOverStore({ busDown = false }: { busDown?: boolean } = {}) {
  const processStore = InMemoryProcessStore.createForTesting();
  const database = MemoryUserDatabase.create({ processStore });
  const { senders } = createUserTestLifecycle();
  const down = {
    send: async () => {
      throw new Error("event bus unavailable");
    },
    sendBatch: async () => {
      throw new Error("event bus unavailable");
    },
  };
  const app = createUserTestApp({
    repositories: memoryUserRepositoriesOver({ database }),
    lifecycle: busDown
      ? { ...senders, recordUserCreated: down, recordUserRegistered: down, recordUserErased: down }
      : senders,
  });
  return { app, database, processStore };
}

describe("user's created fact", () => {
  describe("when an account is minted", () => {
    /** @scenario "Every account mint records user's created fact" */
    it("commits one created fact to the outbox for each mint path", async () => {
      const { app, database, processStore } = appOverStore();

      const directory = await app.create({ name: "Dir", email: "dir@example.com" });
      const credential = await app.registerCredentialAccount({
        name: "Cred",
        email: "cred@example.com",
        password: "first",
        addressConfirmed: false,
      });
      const passkey = await app.createPasskeyUser({ email: "key@example.com" });

      expect(
        (await userFactsIn({ processStore, userIds: database.rows().map(({ id }) => id) })).filter(
          ({ type }) => type === "recordCreated",
        ),
      ).toEqual(
        [directory.id, credential.id, passkey.id].map((userId) => ({
          type: "recordCreated",
          data: { tenantId: userId, userId, occurredAt: expect.any(Number) },
        })),
      );
    });
  });

  describe("when the event bus is down", () => {
    /** @scenario "A mint answers while the event bus is down" */
    it("still mints the account, its fact waiting in the outbox", async () => {
      const { app, database, processStore } = appOverStore({ busDown: true });

      const created = await app.create({ name: "Dir", email: "dir@example.com" });

      await expect(app.findById({ id: created.id })).resolves.toMatchObject({
        email: "dir@example.com",
      });
      expect(
        (await userFactsIn({ processStore, userIds: database.rows().map(({ id }) => id) })).map(
          ({ type }) => type,
        ),
      ).toEqual(["recordCreated"]);
    });
  });

  describe("when the worker's outbox delivers a committed fact", () => {
    /** @scenario "The fact outbox records each committed fact on user's pipeline" */
    it("sends it on user_lifecycle under the data the write committed", async () => {
      const lifecycle = createUserTestLifecycle();
      const app = createUserTestApp({ lifecycle: lifecycle.senders });
      const data = { tenantId: "user-1", userId: "user-1", occurredAt: 5 };

      await app.recordLifecycleFact({ type: "recordCreated", data });
      await app.recordLifecycleFact({ type: "recordErased", data });

      expect(lifecycle.recorded).toEqual([
        { type: "created", data },
        { type: "erased", data },
      ]);
    });

    /** @scenario "The fact outbox records each committed fact on user's pipeline" */
    it("throws while the bus is down, so the outbox retries it", async () => {
      const { app } = appOverStore({ busDown: true });

      await expect(
        app.recordLifecycleFact({
          type: "recordCreated",
          data: { tenantId: "user-1", userId: "user-1", occurredAt: 5 },
        }),
      ).rejects.toThrow("event bus unavailable");
    });
  });

  describe("given accounts stored before the created fact existed", () => {
    async function storedAccounts() {
      const log = lifecycleLog();
      const app = createUserTestApp({
        repositories: {
          ...MemoryUserRepositories.create({
            processStore: InMemoryProcessStore.createForTesting(),
          }),
          standings: EventingUserStandingRepository.create({ eventReadSeat: log.eventReadSeat }),
        },
        lifecycle: log.senders,
      });
      const ids: string[] = [];
      for (const email of ["a@example.com", "b@example.com", "c@example.com"]) {
        ids.push((await app.create({ name: "Stored", email })).id);
      }
      log.facts.length = 0;
      log.batches.length = 0;
      return { app, log, ids: ids.toSorted() };
    }

    function run(
      app: Awaited<ReturnType<typeof storedAccounts>>["app"],
      overrides: Partial<Parameters<typeof app.recordExistingCreatedFacts>[0]> = {},
    ) {
      return app.recordExistingCreatedFacts({
        dryRun: false,
        signal: never,
        afterUserId: null,
        countedBefore: { users: 0, deactivated: 0, reactivated: 0 },
        onPageDone: async () => undefined,
        ...overrides,
      });
    }

    /** @scenario "The seed step records a created fact for every existing account" */
    it("records each account once, backfilled, stamped with when its row was written", async () => {
      const { app, log, ids } = await storedAccounts();
      const saved: unknown[] = [];

      const report = await run(app, { onPageDone: async (page) => void saved.push(page) });

      expect(report).toEqual({ users: 3, deactivated: 0, reactivated: 0 });
      expect(log.facts).toEqual(
        ids.map((userId) => ({
          type: "created",
          data: { tenantId: userId, userId, occurredAt: expect.any(Number), backfilled: true },
        })),
      );
      expect(saved).toEqual([
        { afterUserId: ids.at(-1), report: { users: 3, deactivated: 0, reactivated: 0 } },
      ]);
    });

    /** @scenario "The seed step sends each page as batches, every created fact before the page's standing facts" */
    it("sends a page as one batch per fact kind, created before any standing", async () => {
      const { app, log, ids } = await storedAccounts();
      await log.senders.recordUserDeactivated.send({
        tenantId: ids[0] ?? "",
        userId: ids[0] ?? "",
        occurredAt: 5,
      });
      await app.deactivate({ id: ids[1] ?? "", actor: SYSTEM });
      log.batches.length = 0;

      const report = await run(app);

      expect(report).toEqual({ users: 3, deactivated: 1, reactivated: 1 });
      expect(log.batches).toEqual([
        { type: "created", userIds: ids },
        { type: "deactivated", userIds: [ids[1]] },
        { type: "reactivated", userIds: [ids[0]] },
      ]);
      expect(log.reads).toEqual([{ aggregateIds: [ids[0], ids[2]] }]);
    });

    /** @scenario "The seed step catches up a missed deactivation" */
    it("records a deactivated account at its stored deactivation time", async () => {
      const { app, log, ids } = await storedAccounts();
      const gone = await app.deactivate({ id: ids[1] ?? "", actor: SYSTEM });
      log.facts.length = 0;

      await run(app);

      expect(log.facts.filter(({ type }) => type === "deactivated")).toEqual([
        {
          type: "deactivated",
          data: {
            tenantId: ids[1],
            userId: ids[1],
            occurredAt: gone.deactivatedAt?.getTime(),
            actor: SYSTEM,
          },
        },
      ]);
    });

    /** @scenario "The seed step repairs a missed reactivation" */
    it("records an active account its log holds deactivated as reactivated at the run's start", async () => {
      const { app, log, ids } = await storedAccounts();
      const [missed, settled] = [ids[0] ?? "", ids[2] ?? ""];
      const sent = (userId: string, occurredAt: number) => ({
        tenantId: userId,
        userId,
        occurredAt,
      });
      await log.senders.recordUserDeactivated.send(sent(missed, 5));
      await log.senders.recordUserDeactivated.send(sent(settled, 5));
      await log.senders.recordUserReactivated.send(sent(settled, 9));
      const before = Date.now();

      const report = await run(app);

      expect(report).toEqual({ users: 3, deactivated: 0, reactivated: 1 });
      const repaired = log.facts.filter(
        ({ type, data }) => type === "reactivated" && data.userId === missed,
      );
      expect(repaired).toEqual([
        {
          type: "reactivated",
          data: { tenantId: missed, userId: missed, occurredAt: expect.any(Number), actor: SYSTEM },
        },
      ]);
      expect(repaired[0]?.data.occurredAt).toBeGreaterThanOrEqual(before);
      expect(log.facts.filter(({ type }) => type === "reactivated")).toHaveLength(2);
    });

    /** @scenario "The seed step repairs a missed reactivation" */
    it("treats a deactivation and reactivation at the same instant as deactivated", async () => {
      const { app, log, ids } = await storedAccounts();
      const tied = ids[0] ?? "";
      const sent = { tenantId: tied, userId: tied, occurredAt: 5 };
      await log.senders.recordUserDeactivated.send(sent);
      await log.senders.recordUserReactivated.send(sent);

      await expect(run(app)).resolves.toMatchObject({ reactivated: 1 });
    });

    /** @scenario "Running the seed step twice records once" */
    it("records nothing new the second time", async () => {
      const { app, log, ids } = await storedAccounts();
      await app.deactivate({ id: ids[1] ?? "", actor: SYSTEM });
      await run(app);
      const afterFirst = [...log.facts];

      await run(app);

      expect(log.facts).toEqual(afterFirst);
    });

    /** @scenario "The seed step resumes after the saved user id" */
    /** @scenario "A resumed seed step reports every account its attempts counted" */
    it("resumes after its checkpoint, records nothing before it and counts on from it", async () => {
      const { app, log, ids } = await storedAccounts();
      const saved: unknown[] = [];

      const report = await run(app, {
        afterUserId: ids[1] ?? null,
        countedBefore: { users: 2, deactivated: 1, reactivated: 0 },
        onPageDone: async (page) => void saved.push(page),
      });

      expect(log.batches).toEqual([{ type: "created", userIds: [ids[2]] }]);
      expect(saved).toEqual([
        { afterUserId: ids[2], report: { users: 3, deactivated: 1, reactivated: 0 } },
      ]);
      expect(report).toEqual({ users: 3, deactivated: 1, reactivated: 0 });
    });

    /** @scenario "A resumed seed step reports every account its attempts counted" */
    it("reports the count it resumed with when no account is left after the checkpoint", async () => {
      const { app, log, ids } = await storedAccounts();

      const report = await run(app, {
        afterUserId: ids.at(-1) ?? null,
        countedBefore: { users: 3, deactivated: 0, reactivated: 0 },
      });

      expect(log.batches).toEqual([]);
      expect(report).toEqual({ users: 3, deactivated: 0, reactivated: 0 });
    });

    /** @scenario "The seed step's dry run records nothing" */
    it("sends nothing and saves no checkpoint on a dry run", async () => {
      const { app, log, ids } = await storedAccounts();
      await app.deactivate({ id: ids[1] ?? "", actor: SYSTEM });
      log.batches.length = 0;
      const before = [...log.facts];
      const saved: unknown[] = [];

      const report = await run(app, {
        dryRun: true,
        onPageDone: async (page) => void saved.push(page),
      });

      expect(report).toEqual({ users: 3, deactivated: 1, reactivated: 0 });
      expect(log.batches).toEqual([]);
      expect(log.facts).toEqual(before);
      expect(saved).toEqual([]);
    });
  });
});

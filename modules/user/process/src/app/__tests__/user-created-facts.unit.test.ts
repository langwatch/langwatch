/**
 * @vitest-environment node
 *
 * Every account mint commits user's created fact to its fact outbox with the row, and the
 * `user:record-created-facts` step records it for accounts minted before the fact existed.
 * @see modules/user/specs/user.feature
 */
import { InMemoryProcessStore } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

import { MemoryUserDatabase } from "../../repositories/memory/memory.user.database.ts";
import {
  MemoryUserRepositories,
  memoryUserRepositoriesOver,
} from "../../repositories/memory/memory.user.repositories.ts";
import { createUserTestApp, createUserTestLifecycle, userFactsIn } from "./user.fixture.ts";

const never = new AbortController().signal;

/** An app over a memory store whose fact outbox the test reads, its bus optionally down. */
function appOverStore({ busDown = false }: { busDown?: boolean } = {}) {
  const processStore = InMemoryProcessStore.createForTesting();
  const database = MemoryUserDatabase.create({ processStore });
  const { senders } = createUserTestLifecycle();
  const down = {
    send: async () => {
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
      const repositories = MemoryUserRepositories.create({
        processStore: InMemoryProcessStore.createForTesting(),
      });
      const minting = createUserTestApp({ repositories });
      const ids: string[] = [];
      for (const email of ["a@example.com", "b@example.com", "c@example.com"]) {
        ids.push((await minting.create({ name: "Stored", email })).id);
      }
      const lifecycle = createUserTestLifecycle();
      const app = createUserTestApp({ repositories, lifecycle: lifecycle.senders });
      return { app, lifecycle, ids: ids.toSorted() };
    }

    /** @scenario "The seed step records a created fact for every existing account" */
    it("records each account once, backfilled, stamped with when its row was written", async () => {
      const { app, lifecycle, ids } = await storedAccounts();
      const saved: unknown[] = [];

      const report = await app.recordExistingCreatedFacts({
        dryRun: false,
        signal: never,
        afterUserId: null,
        onPageDone: async (page) => void saved.push(page),
      });

      expect(report).toEqual({ users: 3 });
      expect(lifecycle.recorded).toEqual(
        ids.map((userId) => ({
          type: "created",
          data: { tenantId: userId, userId, occurredAt: expect.any(Number), backfilled: true },
        })),
      );
      expect(saved).toEqual([{ afterUserId: ids.at(-1), report: { users: 3 } }]);
    });

    /** @scenario "The seed step records a created fact for every existing account" */
    it("resumes after its checkpoint and records nothing before it", async () => {
      const { app, lifecycle, ids } = await storedAccounts();

      await app.recordExistingCreatedFacts({
        dryRun: false,
        signal: never,
        afterUserId: ids[1] ?? null,
        onPageDone: async () => undefined,
      });

      expect(lifecycle.recorded.map(({ data }) => data.userId)).toEqual([ids[2]]);
    });

    /** @scenario "The seed step's dry run records nothing" */
    it("records nothing and saves no checkpoint on a dry run", async () => {
      const { app, lifecycle } = await storedAccounts();
      const saved: unknown[] = [];

      const report = await app.recordExistingCreatedFacts({
        dryRun: true,
        signal: never,
        afterUserId: null,
        onPageDone: async (page) => void saved.push(page),
      });

      expect(report).toEqual({ users: 3 });
      expect(lifecycle.recorded).toEqual([]);
      expect(saved).toEqual([]);
    });
  });
});

/**
 * @vitest-environment node
 *
 * The `user:record-standing-facts` step re-states the standing an older image changed without
 * recording the fact, over user's own lifecycle log.
 * @see modules/user/specs/user.feature
 */
import {
  createTenantId,
  EventUtils,
  InMemoryProcessStore,
  type OwnEventStore,
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
import { MemoryUserRepositories } from "../../repositories/memory/memory.user.repositories.ts";
import type { UserLifecycleSenders } from "../../services/user-lifecycle-notice.service.ts";
import { createUserTestApp, createUserTestLifecycle } from "./user.fixture.ts";

const never = new AbortController().signal;
const SYSTEM = { type: "system", id: null } as const;

type LoggedFact = { type: "deactivated" | "reactivated"; data: RecordUserLifecycleCommandData };

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

/** user_lifecycle as a log keyed like its commands: a fact already recorded records nothing. */
function lifecycleLog() {
  const { senders } = createUserTestLifecycle();
  const facts: LoggedFact[] = [];
  const append = (type: LoggedFact["type"]) => ({
    send: async (data: RecordUserLifecycleCommandData) => {
      const known = facts.some(
        (fact) =>
          fact.type === type &&
          fact.data.userId === data.userId &&
          fact.data.occurredAt === data.occurredAt,
      );
      if (!known) facts.push({ type, data });
    },
  });
  const logged: UserLifecycleSenders = {
    ...senders,
    recordUserDeactivated: append("deactivated"),
    recordUserReactivated: append("reactivated"),
  };
  const eventStore: Pick<OwnEventStore, "read"> = {
    read: async ({ aggregateId, accepts }) =>
      facts
        .filter(({ data }) => data.userId === aggregateId)
        .map(standingEventOf)
        .flatMap((event) => (accepts(event) ? [event] : [])),
  };
  return { senders: logged, facts, eventStore };
}

/** Three accounts on one app whose lifecycle log the test reads, ids sorted. */
async function storedAccounts() {
  const log = lifecycleLog();
  const app = createUserTestApp({
    repositories: MemoryUserRepositories.create({
      processStore: InMemoryProcessStore.createForTesting(),
    }),
    lifecycle: log.senders,
  });
  app.keepLifecycleEventStore({ participation: "consume", eventStore: log.eventStore });
  const ids: string[] = [];
  for (const email of ["a@example.com", "b@example.com", "c@example.com"]) {
    ids.push((await app.create({ name: "Stored", email })).id);
  }
  return { app, log, ids: ids.toSorted() };
}

function run(
  app: Awaited<ReturnType<typeof storedAccounts>>["app"],
  overrides: Partial<Parameters<typeof app.recordExistingStandingFacts>[0]> = {},
) {
  return app.recordExistingStandingFacts({
    dryRun: false,
    signal: never,
    afterUserId: null,
    onPageDone: async () => undefined,
    ...overrides,
  });
}

describe("user's standing step", () => {
  describe("given an account an older image deactivated without the fact", () => {
    /** @scenario "The standing step catches up a missed deactivation" */
    it("records it deactivated at its stored deactivation time", async () => {
      const { app, log, ids } = await storedAccounts();
      const gone = await app.deactivate({ id: ids[1] ?? "", actor: SYSTEM });

      const report = await run(app);

      expect(report).toEqual({ deactivated: 1, reactivated: 0 });
      expect(log.facts).toEqual([
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
  });

  describe("given an active account whose log still ends in a deactivation", () => {
    /** @scenario "The standing step repairs a missed reactivation" */
    it("records it reactivated at the run's start, and nothing for the others", async () => {
      const { app, log, ids } = await storedAccounts();
      const [missed, settled] = [ids[0] ?? "", ids[2] ?? ""];
      await log.senders.recordUserDeactivated.send({
        tenantId: missed,
        userId: missed,
        occurredAt: 5,
      });
      await log.senders.recordUserDeactivated.send({
        tenantId: settled,
        userId: settled,
        occurredAt: 5,
      });
      await log.senders.recordUserReactivated.send({
        tenantId: settled,
        userId: settled,
        occurredAt: 9,
      });
      const before = Date.now();

      const report = await run(app);

      expect(report).toEqual({ deactivated: 0, reactivated: 1 });
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
      expect(log.facts).toHaveLength(4);
    });

    /** @scenario "The standing step repairs a missed reactivation" */
    it("treats a deactivation and reactivation at the same instant as deactivated", async () => {
      const { app, log, ids } = await storedAccounts();
      const tied = ids[0] ?? "";
      await log.senders.recordUserDeactivated.send({ tenantId: tied, userId: tied, occurredAt: 5 });
      await log.senders.recordUserReactivated.send({ tenantId: tied, userId: tied, occurredAt: 5 });

      await expect(run(app)).resolves.toEqual({ deactivated: 0, reactivated: 1 });
    });
  });

  describe("when the step runs twice", () => {
    /** @scenario "Running the standing step twice records once" */
    it("records each deactivation and reactivation once", async () => {
      const { app, log, ids } = await storedAccounts();
      await app.deactivate({ id: ids[1] ?? "", actor: SYSTEM });
      const missed = ids[0] ?? "";
      await log.senders.recordUserDeactivated.send({
        tenantId: missed,
        userId: missed,
        occurredAt: 5,
      });

      await run(app);
      const afterFirst = [...log.facts];
      const second = await run(app);

      expect(second).toEqual({ deactivated: 1, reactivated: 0 });
      expect(log.facts).toEqual(afterFirst);
      expect(log.facts.map(({ type }) => type).toSorted()).toEqual([
        "deactivated",
        "deactivated",
        "reactivated",
      ]);
    });
  });

  describe("when the step runs as a dry run", () => {
    /** @scenario "The standing step's dry run writes nothing" */
    it("reports what it would re-state, records nothing and saves no checkpoint", async () => {
      const { app, log, ids } = await storedAccounts();
      await app.deactivate({ id: ids[1] ?? "", actor: SYSTEM });
      const missed = ids[0] ?? "";
      await log.senders.recordUserDeactivated.send({
        tenantId: missed,
        userId: missed,
        occurredAt: 5,
      });
      const before = [...log.facts];
      const saved: unknown[] = [];

      const report = await run(app, {
        dryRun: true,
        onPageDone: async (page) => void saved.push(page),
      });

      expect(report).toEqual({ deactivated: 1, reactivated: 1 });
      expect(log.facts).toEqual(before);
      expect(saved).toEqual([]);
    });
  });

  describe("when it resumes from a checkpoint", () => {
    /** @scenario "The standing step resumes after the saved user id" */
    it("re-states only the accounts after the saved id and saves each finished page", async () => {
      const { app, log, ids } = await storedAccounts();
      for (const id of ids) await app.deactivate({ id, actor: SYSTEM });
      const saved: unknown[] = [];

      const report = await run(app, {
        afterUserId: ids[1] ?? null,
        onPageDone: async (page) => void saved.push(page),
      });

      expect(report).toEqual({ deactivated: 1, reactivated: 0 });
      expect(log.facts.map(({ data }) => data.userId)).toEqual([ids[2]]);
      expect(saved).toEqual([{ afterUserId: ids[2], report: { deactivated: 1, reactivated: 0 } }]);
    });
  });
});

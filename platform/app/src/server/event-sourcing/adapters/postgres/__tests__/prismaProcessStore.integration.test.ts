import { createHash } from "node:crypto";
import type { JsonValue, NewOutboxMessage, ProcessCommit, ProcessRef } from "@langwatch/eventing";
import { nanoid } from "nanoid";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { PrismaProcessStore } from "@langwatch/eventing/server";

const store = PrismaProcessStore.create({ database: prisma });
let processName: string;

function ref(processKey = "conversation-1", projectId = "project-1"): ProcessRef {
  return { processName, projectId, processKey };
}

function message(messageKey: string, overrides: Partial<NewOutboxMessage> = {}): NewOutboxMessage {
  return {
    messageKey,
    intentType: "langy.test.intent",
    payload: {
      conversationId: "conversation-1",
      nested: { flags: [true, null], count: 2 },
    },
    traceCarrier: {
      traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      tracestate: "vendor=value",
      baggage: "tenant.id=tenant-1,user.id=user-1",
      "x-custom-propagation": "preserved",
    },
    userId: "user-1",
    ...overrides,
  };
}

function commit({
  target = ref(),
  sourceEventId = "event-1",
  expectedRevision = 0,
  state = { step: 1 },
  nextWakeAt = null,
  messages = [message("message-1")],
  now = 1_000,
  tenantId = "tenant-1",
}: {
  target?: ProcessRef;
  sourceEventId?: string | null;
  expectedRevision?: number;
  state?: JsonValue;
  nextWakeAt?: number | null;
  messages?: NewOutboxMessage[];
  now?: number;
  tenantId?: string;
} = {}): ProcessCommit<JsonValue> {
  return {
    ref: target,
    tenantId,
    userId: "user-1",
    sourceEventId,
    expectedRevision,
    state,
    nextWakeAt,
    messages,
    now,
  };
}

async function clean(): Promise<void> {
  const where = {
    processName: { in: [processName, `${processName}-other`] },
    projectId: { in: ["project-1", "project-2"] },
  };
  await cleanupTestRows(prisma, [
    ["processManagerOutbox", where],
    ["processManagerInbox", where],
    ["processManagerInstance", where],
  ]);
}

describe("PrismaProcessStore", () => {
  beforeEach(() => {
    processName = `process-store-${nanoid(10)}`;
  });

  afterEach(async () => {
    await clean();
  });

  it("commits state, inbox, wake, and deduped outbox rows atomically", async () => {
    const targetA = ref("conversation-a");
    const targetB = ref("conversation-b");
    const sourceEventId = "shared-event";

    const results = await Promise.all([
      store.commit(
        commit({
          target: targetA,
          sourceEventId,
          state: { winner: "a" },
          messages: [message("shared-message")],
        }),
      ),
      store.commit(
        commit({
          target: targetB,
          sourceEventId,
          state: { winner: "b" },
          messages: [message("shared-message")],
        }),
      ),
    ]);

    expect(results.map((result) => result.outcome).sort()).toEqual(["committed", "duplicateEvent"]);
    expect(
      await prisma.processManagerInstance.count({
        where: { processName, projectId: "project-1" },
      }),
    ).toBe(1);
    expect(
      await prisma.processManagerInbox.count({
        where: { processName, projectId: "project-1" },
      }),
    ).toBe(1);
    expect(
      await prisma.processManagerOutbox.count({
        where: { processName, projectId: "project-1" },
      }),
    ).toBe(1);
  });

  it("treats a duplicate inbox event as a complete no-op", async () => {
    await store.commit(commit());

    const duplicate = await store.commit(
      commit({
        expectedRevision: 1,
        state: { step: 2 },
        messages: [message("message-2")],
        now: 2_000,
      }),
    );

    expect(duplicate).toEqual({ outcome: "duplicateEvent" });
    expect(await store.findByRef({ ref: ref() })).toEqual(
      expect.objectContaining({ state: { step: 1 }, revision: 1 }),
    );
    expect((await store.findMessagesByRef({ ref: ref() })).map((row) => row.messageKey)).toEqual([
      "message-1",
    ]);
  });

  it("allows exactly one concurrent revision CAS and rolls back the loser", async () => {
    await store.commit(commit());

    const results = await Promise.all([
      store.commit(
        commit({
          sourceEventId: "event-a",
          expectedRevision: 1,
          state: { winner: "a" },
          messages: [message("message-a")],
          now: 2_000,
        }),
      ),
      store.commit(
        commit({
          sourceEventId: "event-b",
          expectedRevision: 1,
          state: { winner: "b" },
          messages: [message("message-b")],
          now: 2_000,
        }),
      ),
    ]);

    expect(results.map((result) => result.outcome).sort()).toEqual([
      "committed",
      "revisionConflict",
    ]);
    const conflictIndex = results.findIndex((result) => result.outcome === "revisionConflict");
    const losingEvent = conflictIndex === 0 ? "event-a" : "event-b";
    const losingMessage = conflictIndex === 0 ? "message-a" : "message-b";
    expect(
      await prisma.processManagerInbox.count({
        where: {
          processName,
          projectId: "project-1",
          sourceEventId: losingEvent,
        },
      }),
    ).toBe(0);
    expect(
      await prisma.processManagerOutbox.count({
        where: {
          processName,
          projectId: "project-1",
          messageKey: losingMessage,
        },
      }),
    ).toBe(0);
    expect((await store.findByRef({ ref: ref() }))?.revision).toBe(2);
  });

  it("deduplicates message keys without rejecting the state transition", async () => {
    await store.commit(commit());

    const result = await store.commit(
      commit({
        sourceEventId: "event-2",
        expectedRevision: 1,
        state: { step: 2 },
        messages: [message("message-1")],
        now: 2_000,
      }),
    );

    expect(result).toEqual({
      outcome: "committed",
      revision: 2,
      insertedMessageKeys: [],
      duplicateMessageKeys: ["message-1"],
    });
    expect(
      await prisma.processManagerInbox.count({
        where: { processName, projectId: "project-1" },
      }),
    ).toBe(2);
    expect(
      await prisma.processManagerOutbox.count({
        where: { processName, projectId: "project-1" },
      }),
    ).toBe(1);
  });

  it("preserves the full W3C carrier through commit and lease", async () => {
    await store.commit(
      commit({
        messages: [message("live")],
      }),
    );

    const leased = await store.leaseDueMessages({
      now: 1_000,
      limit: 10,
      leaseDurationMs: 30_000,
    });

    expect(leased).toHaveLength(1);
    expect(leased[0]).toEqual(
      expect.objectContaining({
        messageKey: "live",
        traceCarrier: message("live").traceCarrier,
      }),
    );
  });

  it("leases a due message to only one competing worker", async () => {
    await store.commit(commit());

    const leases = await Promise.all([
      store.leaseDueMessages({
        now: 1_000,
        limit: 1,
        leaseDurationMs: 30_000,
      }),
      store.leaseDueMessages({
        now: 1_000,
        limit: 1,
        leaseDurationMs: 30_000,
      }),
    ]);

    expect(leases.flat().map((row) => row.messageKey)).toEqual(["message-1"]);
  });

  describe("given a leased outbox message", () => {
    const base = 1_700_000_000_000;
    // processName is regenerated per test, so the identity is built inside
    // each one rather than captured at collection time.
    const identityOf = () => ({
      processName,
      projectId: "project-1",
      messageKey: "message-1",
    });

    describe("when the lease lapses and another dispatcher re-leases it", () => {
      it("rejects the stale acknowledgement and keeps the live lease intact", async () => {
        const identity = identityOf();
        await store.commit(commit({ now: base }));
        const first = (
          await store.leaseDueMessages({
            now: base,
            limit: 1,
            leaseDurationMs: 100,
          })
        )[0]!;
        const second = (
          await store.leaseDueMessages({
            now: base + 100,
            limit: 1,
            leaseDurationMs: 100,
          })
        )[0]!;
        expect(second.leaseToken).not.toBe(first.leaseToken);

        const staleDispatch = await store.markDispatched({
          identity,
          leaseToken: first.leaseToken,
          now: base + 101,
        });
        const staleFail = await store.markFailed({
          identity,
          leaseToken: first.leaseToken,
          now: base + 102,
          nextAttemptAt: base + 1_000,
          dead: true,
        });
        expect(staleDispatch).toEqual({ applied: false });
        expect(staleFail).toEqual({ applied: false });

        // Each lease charged one delivery start; the fenced acknowledgements
        // changed nothing.
        expect(await store.findMessagesByRef({ ref: ref() })).toEqual([
          expect.objectContaining({
            status: "pending",
            attempts: 2,
            leaseToken: second.leaseToken,
          }),
        ]);

        const liveDispatch = await store.markDispatched({
          identity,
          leaseToken: second.leaseToken,
          now: base + 103,
        });
        expect(liveDispatch).toEqual({ applied: true });
        expect(await store.findMessagesByRef({ ref: ref() })).toEqual([
          expect.objectContaining({
            status: "dispatched",
            attempts: 2,
            leaseToken: null,
          }),
        ]);
      });
    });

    describe("when the lease is released un-attempted", () => {
      it("hands the attempt back and leaves the message immediately due", async () => {
        const identity = identityOf();
        await store.commit(commit({ now: base }));
        const leased = (
          await store.leaseDueMessages({
            now: base,
            limit: 1,
            leaseDurationMs: 30_000,
          })
        )[0]!;
        expect(leased.attempts).toBe(1);

        const released = await store.releaseLease({
          identity,
          leaseToken: leased.leaseToken,
          now: base + 10,
        });
        expect(released).toEqual({ applied: true });

        // The attempt the lease charged was handed back, and the message is
        // leasable in the same instant: no backoff for work that never ran.
        const again = (
          await store.leaseDueMessages({
            now: base + 10,
            limit: 1,
            leaseDurationMs: 30_000,
          })
        )[0]!;
        expect(again.messageKey).toBe("message-1");
        expect(again.attempts).toBe(1);

        // A release with the superseded token is a no-op.
        const stale = await store.releaseLease({
          identity,
          leaseToken: leased.leaseToken,
          now: base + 20,
        });
        expect(stale).toEqual({ applied: false });
      });
    });
  });

  it("persists retry, dead, and dispatched transitions with exact epoch times", async () => {
    const base = 1_700_000_000_000;
    await store.commit(
      commit({
        messages: [message("retry"), message("success")],
        now: base,
      }),
    );
    const initialLeases = await store.leaseDueMessages({
      now: base,
      limit: 10,
      leaseDurationMs: 30_000,
    });
    const retryLease = initialLeases.find((row) => row.messageKey === "retry")!;
    const successLease = initialLeases.find((row) => row.messageKey === "success")!;

    await store.markFailed({
      identity: {
        processName,
        projectId: "project-1",
        messageKey: "retry",
      },
      leaseToken: retryLease.leaseToken,
      now: base + 100,
      nextAttemptAt: base + 1_000,
      dead: false,
    });
    await store.markDispatched({
      identity: {
        processName,
        projectId: "project-1",
        messageKey: "success",
      },
      leaseToken: successLease.leaseToken,
      now: base + 200,
    });

    expect(
      await store.leaseDueMessages({
        now: base + 999,
        limit: 10,
        leaseDurationMs: 30_000,
      }),
    ).toEqual([]);
    const retryAgain = await store.leaseDueMessages({
      now: base + 1_000,
      limit: 10,
      leaseDurationMs: 30_000,
    });
    expect(retryAgain.map((row) => row.messageKey)).toEqual(["retry"]);

    await store.markFailed({
      identity: {
        processName,
        projectId: "project-1",
        messageKey: "retry",
      },
      leaseToken: retryAgain[0]!.leaseToken,
      now: base + 1_100,
      nextAttemptAt: base + 9_999,
      dead: true,
    });

    const rows = await prisma.processManagerOutbox.findMany({
      where: { processName, projectId: "project-1" },
      orderBy: { messageKey: "asc" },
    });
    expect(
      rows.map((row) => ({
        key: row.messageKey,
        status: row.status,
        attempts: row.attempts,
        nextAttemptAt: row.nextAttemptAt.getTime(),
        dispatchedAt: row.dispatchedAt?.getTime() ?? null,
        leaseToken: row.leaseToken,
        updatedAt: row.updatedAt.getTime(),
      })),
    ).toEqual([
      {
        key: "retry",
        status: "dead",
        attempts: 2,
        nextAttemptAt: base + 9_999,
        dispatchedAt: null,
        leaseToken: null,
        updatedAt: base + 1_100,
      },
      {
        key: "success",
        status: "dispatched",
        attempts: 1,
        nextAttemptAt: base,
        dispatchedAt: base + 200,
        leaseToken: null,
        updatedAt: base + 200,
      },
    ]);
  });

  it("returns only due wakes with the revision that scheduled them", async () => {
    await store.commit(commit({ target: ref("due"), nextWakeAt: 1_500, messages: [] }));
    await store.commit(
      commit({
        target: ref("future"),
        sourceEventId: "event-2",
        nextWakeAt: 2_500,
        messages: [],
      }),
    );
    await store.commit(
      commit({
        target: ref("none"),
        sourceEventId: "event-3",
        nextWakeAt: null,
        messages: [],
      }),
    );

    expect(await store.findDueWakes({ now: 2_000, limit: 10 })).toEqual([
      { ref: ref("due"), revision: 1, wakeAt: 1_500 },
    ]);
  });

  it("filters raw-SQL outbox leases and wake scans by process name", async () => {
    const selected = ref("selected");
    const other = {
      ...ref("other"),
      processName: `${processName}-other`,
    };
    await store.commit(
      commit({
        target: selected,
        nextWakeAt: 1_500,
        messages: [message("selected-message")],
      }),
    );
    await store.commit(
      commit({
        target: other,
        sourceEventId: "event-other",
        nextWakeAt: 1_500,
        messages: [message("other-message")],
      }),
    );

    const leased = await store.leaseDueMessages({
      now: 2_000,
      limit: 10,
      leaseDurationMs: 30_000,
      processNames: [processName],
    });
    expect(leased.map((row) => row.messageKey)).toEqual(["selected-message"]);

    const wakes = await store.findDueWakes({
      now: 2_000,
      limit: 10,
      processNames: [processName],
    });
    expect(wakes).toEqual([{ ref: selected, revision: 1, wakeAt: 1_500 }]);
  });

  it("isolates identical process and message keys by project", async () => {
    const projectOne = ref("same-conversation", "project-1");
    const projectTwo = ref("same-conversation", "project-2");
    await store.commit(
      commit({
        target: projectOne,
        state: { project: 1 },
        tenantId: "tenant-1",
      }),
    );
    await store.commit(
      commit({
        target: projectTwo,
        state: { project: 2 },
        tenantId: "tenant-2",
      }),
    );

    expect(await store.findByRef({ ref: projectOne })).toEqual(
      expect.objectContaining({ tenantId: "tenant-1", state: { project: 1 } }),
    );
    expect(await store.findByRef({ ref: projectTwo })).toEqual(
      expect.objectContaining({ tenantId: "tenant-2", state: { project: 2 } }),
    );
    expect(await store.findMessagesByRef({ ref: projectOne })).toHaveLength(1);
    expect(await store.findMessagesByRef({ ref: projectTwo })).toHaveLength(1);
  });

  it("prunes only dispatched rows past the cutoff, across projects and statuses", async () => {
    const base = 1_700_000_000_000;
    const cutoff = base + 10_000;

    const oldDispatchedProjectOne = ref("old-dispatched-1", "project-1");
    const oldDispatchedProjectTwo = ref("old-dispatched-2", "project-2");
    const freshDispatched = ref("fresh-dispatched", "project-1");
    const stillPending = ref("still-pending", "project-1");
    const deadLetter = ref("dead-letter", "project-1");

    await store.commit(
      commit({
        target: oldDispatchedProjectOne,
        sourceEventId: "event-old-1",
        messages: [message("old-dispatched-1-msg")],
        now: base,
      }),
    );
    await store.commit(
      commit({
        target: oldDispatchedProjectTwo,
        sourceEventId: "event-old-2",
        tenantId: "tenant-2",
        messages: [message("old-dispatched-2-msg")],
        now: base,
      }),
    );
    await store.commit(
      commit({
        target: freshDispatched,
        sourceEventId: "event-fresh",
        messages: [message("fresh-dispatched-msg")],
        now: base,
      }),
    );
    await store.commit(
      commit({
        target: deadLetter,
        sourceEventId: "event-dead",
        messages: [message("dead-letter-msg")],
        now: base,
      }),
    );
    // Committed with a nextAttemptAt past the lease scan's `now` below, so it
    // is never leased and stays genuinely pending (not just un-dispatched).
    await store.commit(
      commit({
        target: stillPending,
        sourceEventId: "event-pending",
        messages: [message("still-pending-msg")],
        now: cutoff + 5_000,
      }),
    );

    const leased = await store.leaseDueMessages({
      now: base,
      limit: 10,
      leaseDurationMs: 30_000,
    });
    const leaseFor = (messageKey: string) => leased.find((row) => row.messageKey === messageKey)!;

    await store.markDispatched({
      identity: {
        processName,
        projectId: "project-1",
        messageKey: "old-dispatched-1-msg",
      },
      leaseToken: leaseFor("old-dispatched-1-msg").leaseToken,
      now: base + 1_000,
    });
    await store.markDispatched({
      identity: {
        processName,
        projectId: "project-2",
        messageKey: "old-dispatched-2-msg",
      },
      leaseToken: leaseFor("old-dispatched-2-msg").leaseToken,
      now: base + 1_000,
    });
    await store.markDispatched({
      identity: {
        processName,
        projectId: "project-1",
        messageKey: "fresh-dispatched-msg",
      },
      leaseToken: leaseFor("fresh-dispatched-msg").leaseToken,
      now: cutoff + 1_000,
    });
    await store.markFailed({
      identity: {
        processName,
        projectId: "project-1",
        messageKey: "dead-letter-msg",
      },
      leaseToken: leaseFor("dead-letter-msg").leaseToken,
      now: base + 1_000,
      nextAttemptAt: base + 2_000,
      dead: true,
    });

    const deletedCount = await store.deleteDispatchedBefore({
      processName,
      before: cutoff,
    });

    // The call must not throw (this doubles as the regression test for the
    // cross-tenant multitenancy-guard bug) and must delete exactly the two
    // dispatched rows older than the cutoff, regardless of project.
    expect(deletedCount).toBe(2);

    const remaining = await prisma.processManagerOutbox.findMany({
      where: {
        processName,
        projectId: { in: ["project-1", "project-2"] },
      },
      orderBy: { messageKey: "asc" },
    });
    expect(remaining.map((row) => ({ key: row.messageKey, status: row.status }))).toEqual([
      { key: "dead-letter-msg", status: "dead" },
      { key: "fresh-dispatched-msg", status: "dispatched" },
      { key: "still-pending-msg", status: "pending" },
    ]);
  });

  // A source event id is `idempotencyKey ?? id`, composed by whichever pipeline
  // emits the command. These run against real Postgres because the failure they
  // pin is the database refusing the index row (SQLSTATE 54000) — an in-memory
  // store cannot express it, and a string-length assertion would not observe it.
  describe("given a source event id far past the btree index limit", () => {
    // The filler has to be INCOMPRESSIBLE or this whole block is a test that
    // cannot fail. Postgres pglz-compresses a datum before it goes into the
    // index, so repetitive filler shrinks under the limit and inserts happily
    // against the OLD index too. The production value was a base64 thought
    // signature — high entropy, no compression — so the fixture chains sha256
    // digests: deterministic across runs, and pglz cannot shrink it either.
    // `is still rejected by the pre-fix index shape` below pins that against
    // the real engine, so the fixture cannot silently degrade into one that
    // would pass with or without the digest key.
    const incompressible = (length: number): string => {
      let out = "";
      let block = createHash("sha256").update("langy-tool-call").digest("hex");
      while (out.length < length) {
        out += block;
        block = createHash("sha256").update(block).digest("hex");
      }
      return out.slice(0, length);
    };
    // 3,017 characters is what production actually sent: a Gemini thought
    // signature stapled onto a tool call id, inside a composed idempotency key.
    const oversized = (suffix = "") =>
      `project-1:langyconv_1:tool-start:oljdh6z0_ts_${incompressible(2936)}${suffix}`;

    it("is still rejected by the pre-fix index shape", async () => {
      // Builds a replica of the constraint as it was before the digest key and
      // shows Postgres itself refusing this exact value. This is the assertion
      // that gives the rest of the block its meaning: without it, a fixture
      // that drifted into being compressible would make them all vacuous.
      await prisma.$executeRawUnsafe(
        `CREATE TEMP TABLE pre_fix_inbox ("processName" TEXT, "projectId" TEXT, "sourceEventId" TEXT)`,
      );
      await prisma.$executeRawUnsafe(
        `CREATE UNIQUE INDEX pre_fix_inbox_key ON pre_fix_inbox("processName", "projectId", "sourceEventId")`,
      );

      await expect(
        prisma.$executeRawUnsafe(
          `-- @tenancy: probe against a session-local temp table\nINSERT INTO pre_fix_inbox VALUES ($1, $2, $3)`,
          processName,
          "project-1",
          oversized(),
        ),
      ).rejects.toThrow(/exceeds btree version \d+ maximum/);
    });

    describe("when the process commits its consumption of the event", () => {
      /** @scenario A source event id far past the index limit is still consumed */
      it("commits instead of failing on the index row size", async () => {
        const result = await store.commit(commit({ sourceEventId: oversized(), messages: [] }));

        expect(result.outcome).toBe("committed");
      });

      /** @scenario A source event id far past the index limit is still consumed */
      it("keeps the raw source event id on the row for diagnostics", async () => {
        const sourceEventId = oversized();
        await store.commit(commit({ sourceEventId, messages: [] }));

        const row = await prisma.processManagerInbox.findFirst({
          where: { processName, projectId: "project-1" },
        });
        expect(row?.sourceEventId).toBe(sourceEventId);
      });
    });

    describe("when two such ids share a long common prefix", () => {
      /** @scenario Two different long source event ids stay distinct */
      it("consumes both without mistaking one for the other", async () => {
        const first = await store.commit(
          commit({
            target: ref("conversation-a"),
            sourceEventId: oversized("-a"),
            messages: [],
          }),
        );
        const second = await store.commit(
          commit({
            target: ref("conversation-b"),
            sourceEventId: oversized("-b"),
            messages: [],
          }),
        );

        expect([first.outcome, second.outcome]).toEqual(["committed", "committed"]);
        expect(
          await prisma.processManagerInbox.count({
            where: { processName, projectId: "project-1" },
          }),
        ).toBe(2);
      });
    });

    describe("when the same event is delivered again", () => {
      /** @scenario Redelivery of a long source event id is still deduplicated */
      it("reports the redelivery as a duplicate and writes no second row", async () => {
        const sourceEventId = oversized();
        await store.commit(commit({ sourceEventId, messages: [] }));

        const redelivery = await store.commit(
          commit({ sourceEventId, expectedRevision: 1, messages: [] }),
        );

        expect(redelivery.outcome).toBe("duplicateEvent");
        expect(
          await prisma.processManagerInbox.count({
            where: { processName, projectId: "project-1" },
          }),
        ).toBe(1);
      });
    });

    describe("when a later event arrives for the same process", () => {
      /** @scenario A long source event id no longer blocks the process */
      it("processes the later event instead of wedging on the oversized one", async () => {
        const first = await store.commit(commit({ sourceEventId: oversized(), messages: [] }));
        expect(first.outcome).toBe("committed");

        const later = await store.commit(
          commit({
            sourceEventId: "event-after-the-oversized-one",
            expectedRevision: 1,
            state: { step: 2 },
            messages: [message("later-message")],
          }),
        );

        expect(later).toMatchObject({ outcome: "committed", revision: 2 });
      });
    });
  });

  describe("given dead outbox messages", () => {
    async function commitAndKill(messageKey: string): Promise<void> {
      await store.commit(
        commit({
          sourceEventId: `event-${messageKey}`,
          expectedRevision: 0,
          messages: [message(messageKey)],
        }),
      );
      const [leased] = await store.leaseDueMessages({
        now: 2_000,
        limit: 10,
        leaseDurationMs: 30_000,
        processNames: [processName],
      });
      await store.markFailed({
        identity: {
          processName,
          projectId: "project-1",
          messageKey,
        },
        leaseToken: leased!.leaseToken,
        now: 2_000,
        nextAttemptAt: 3_000,
        dead: true,
      });
    }

    /** @scenario Dead lettered batches can be requeued */
    it("requeues them as pending with a fresh attempt budget, due now", async () => {
      await commitAndKill("send:endpoint-a:deadbeef");

      const requeued = await store.requeueDeadMessages({
        processName,
        projectId: "project-1",
        processKey: "conversation-1",
        now: 5_000,
      });
      expect(requeued).toBe(1);

      const leased = await store.leaseDueMessages({
        now: 5_001,
        limit: 10,
        leaseDurationMs: 30_000,
        processNames: [processName],
      });
      expect(leased).toHaveLength(1);
      // The requeue reset the budget to zero; the fresh lease then charged
      // the first delivery start.
      expect(leased[0]).toMatchObject({
        messageKey: "send:endpoint-a:deadbeef",
        status: "pending",
        attempts: 1,
      });
    });

    it("a message key prefix narrows the requeue to one target's messages", async () => {
      await commitAndKill("send:endpoint-a:111111");
      const second = await store.commit(
        commit({
          sourceEventId: "event-second",
          expectedRevision: 1,
          state: { step: 2 },
          messages: [message("send:endpoint-b:222222")],
        }),
      );
      expect(second.outcome).toBe("committed");
      const [leasedB] = await store.leaseDueMessages({
        now: 2_500,
        limit: 10,
        leaseDurationMs: 30_000,
        processNames: [processName],
      });
      await store.markFailed({
        identity: {
          processName,
          projectId: "project-1",
          messageKey: "send:endpoint-b:222222",
        },
        leaseToken: leasedB!.leaseToken,
        now: 2_500,
        nextAttemptAt: 3_000,
        dead: true,
      });

      const requeued = await store.requeueDeadMessages({
        processName,
        projectId: "project-1",
        processKey: "conversation-1",
        messageKeyPrefix: "send:endpoint-b:",
        now: 6_000,
      });
      expect(requeued).toBe(1);

      const leased = await store.leaseDueMessages({
        now: 6_001,
        limit: 10,
        leaseDurationMs: 30_000,
        processNames: [processName],
      });
      expect(leased.map((m) => m.messageKey)).toEqual(["send:endpoint-b:222222"]);
    });
  });

  // The retention sweep is the one caller that deliberately has no processName
  // predicate: it reaps by age across every process manager, which is what
  // makes it cover the six processes that never registered a prune of their
  // own. That breadth is also why these fixtures sit at epoch 1970 — a cutoff
  // of a few thousand milliseconds cannot reach any other suite's rows, which
  // all timestamp from `Date.now()`, so the exact counts below stay exact even
  // when integration files run in parallel against the same database.
  describe("given retention-eligible rows across every process name", () => {
    describe("when the retention sweep runs", () => {
      const ancient = 1_000;
      const recent = 900_000;
      const cutoff = 500_000;

      /** Commits one message and drives it to `dispatched` at `dispatchedAt`. */
      async function dispatchedRow({
        processKey,
        messageKey,
        sourceEventId,
        dispatchedAt,
        overrideProcessName,
      }: {
        processKey: string;
        messageKey: string;
        sourceEventId: string;
        dispatchedAt: number;
        overrideProcessName?: string;
      }): Promise<void> {
        const name = overrideProcessName ?? processName;
        const target: ProcessRef = {
          processName: name,
          projectId: "project-1",
          processKey,
        };
        await store.commit(
          commit({
            target,
            sourceEventId,
            messages: [message(messageKey)],
            now: ancient,
          }),
        );
        const leased = await store.leaseDueMessages({
          now: ancient,
          limit: 10,
          leaseDurationMs: 30_000,
          processNames: [name],
        });
        const lease = leased.find((row) => row.messageKey === messageKey)!;
        await store.markDispatched({
          identity: { processName: name, projectId: "project-1", messageKey },
          leaseToken: lease.leaseToken,
          now: dispatchedAt,
        });
      }

      /** @scenario "Dispatched outbox rows past the retention window are deleted" */
      it("deletes dispatched rows past the cutoff and keeps the ones inside it", async () => {
        await dispatchedRow({
          processKey: "expired",
          messageKey: "expired-msg",
          sourceEventId: "event-expired",
          dispatchedAt: ancient,
        });
        await dispatchedRow({
          processKey: "inside-window",
          messageKey: "inside-window-msg",
          sourceEventId: "event-inside",
          dispatchedAt: recent,
        });

        const deleted = await store.deleteDispatchedOutboxBatch({
          before: cutoff,
          limit: 5_000,
        });

        expect(deleted).toBe(1);
        const remaining = await prisma.processManagerOutbox.findMany({
          where: { processName, projectId: "project-1" },
          select: { messageKey: true },
        });
        expect(remaining.map((row) => row.messageKey)).toEqual(["inside-window-msg"]);
      });

      /** @scenario "Pending outbox rows are never swept" */
      it("keeps a pending row that is older than every retention window", async () => {
        await store.commit(
          commit({
            target: ref("still-pending", "project-1"),
            sourceEventId: "event-pending",
            messages: [message("pending-msg")],
            now: ancient,
          }),
        );

        expect(
          await store.deleteDispatchedOutboxBatch({
            before: cutoff,
            limit: 5_000,
          }),
        ).toBe(0);
        expect(await store.deleteDeadOutboxBatch({ before: cutoff, limit: 5_000 })).toBe(0);

        const leased = await store.leaseDueMessages({
          now: recent,
          limit: 10,
          leaseDurationMs: 30_000,
          processNames: [processName],
        });
        expect(leased.map((row) => row.messageKey)).toEqual(["pending-msg"]);
      });

      /** @scenario "Dead outbox rows are kept far longer than dispatched ones" */
      it("keeps a dead row until its own longer window elapses", async () => {
        const deadAt = 200_000;
        await store.commit(
          commit({
            target: ref("dead-letter", "project-1"),
            sourceEventId: "event-dead",
            messages: [message("dead-msg")],
            now: ancient,
          }),
        );
        const leased = await store.leaseDueMessages({
          now: ancient,
          limit: 10,
          leaseDurationMs: 30_000,
          processNames: [processName],
        });
        await store.markFailed({
          identity: {
            processName,
            projectId: "project-1",
            messageKey: "dead-msg",
          },
          leaseToken: leased[0]!.leaseToken,
          now: deadAt,
          nextAttemptAt: deadAt,
          dead: true,
        });

        // The dispatched family must not touch it, and neither must a dead sweep
        // whose cutoff it still predates.
        expect(
          await store.deleteDispatchedOutboxBatch({
            before: cutoff,
            limit: 5_000,
          }),
        ).toBe(0);
        expect(await store.deleteDeadOutboxBatch({ before: deadAt, limit: 5_000 })).toBe(0);
        expect(
          await prisma.processManagerOutbox.count({
            where: { processName, projectId: "project-1" },
          }),
        ).toBe(1);

        expect(await store.deleteDeadOutboxBatch({ before: recent, limit: 5_000 })).toBe(1);
        expect(
          await prisma.processManagerOutbox.count({
            where: { processName, projectId: "project-1" },
          }),
        ).toBe(0);
      });

      /** @scenario "Consumed inbox rows past the retention window are deleted" */
      it("deletes inbox rows consumed before the cutoff and keeps later ones", async () => {
        await store.commit(
          commit({
            target: ref("old-inbox", "project-1"),
            sourceEventId: "event-old-inbox",
            messages: [],
            now: ancient,
          }),
        );
        await store.commit(
          commit({
            target: ref("recent-inbox", "project-1"),
            sourceEventId: "event-recent-inbox",
            messages: [],
            now: recent,
          }),
        );

        const deleted = await store.deleteConsumedInboxBatch({
          before: cutoff,
          limit: 5_000,
        });

        expect(deleted).toBe(1);
        const remaining = await prisma.processManagerInbox.findMany({
          where: { processName, projectId: "project-1" },
          select: { sourceEventId: true },
        });
        expect(remaining.map((row) => row.sourceEventId)).toEqual(["event-recent-inbox"]);
      });

      /** @scenario "The sweep reaches process names that never registered retention" */
      it("deletes rows of every process name in one pass", async () => {
        await dispatchedRow({
          processKey: "first",
          messageKey: "first-msg",
          sourceEventId: "event-first",
          dispatchedAt: ancient,
        });
        await dispatchedRow({
          processKey: "second",
          messageKey: "second-msg",
          sourceEventId: "event-second",
          dispatchedAt: ancient,
          overrideProcessName: `${processName}-other`,
        });

        const deleted = await store.deleteDispatchedOutboxBatch({
          before: cutoff,
          limit: 5_000,
        });

        expect(deleted).toBe(2);
        expect(
          await prisma.processManagerOutbox.count({
            where: {
              processName: { in: [processName, `${processName}-other`] },
              projectId: "project-1",
            },
          }),
        ).toBe(0);
      });

      /** @scenario "Process instances are left alone" */
      it("leaves the process instance row and its revision untouched", async () => {
        await dispatchedRow({
          processKey: "with-instance",
          messageKey: "with-instance-msg",
          sourceEventId: "event-with-instance",
          dispatchedAt: ancient,
        });
        const before = await store.findByRef({ ref: ref("with-instance") });

        await store.deleteDispatchedOutboxBatch({
          before: cutoff,
          limit: 5_000,
        });
        await store.deleteConsumedInboxBatch({ before: cutoff, limit: 5_000 });

        const after = await store.findByRef({ ref: ref("with-instance") });
        expect(after).not.toBeNull();
        expect(after!.revision).toBe(before!.revision);
      });

      it("never deletes more than the batch limit in one call", async () => {
        for (const index of [1, 2, 3]) {
          await dispatchedRow({
            processKey: `batched-${index}`,
            messageKey: `batched-${index}-msg`,
            sourceEventId: `event-batched-${index}`,
            dispatchedAt: ancient,
          });
        }

        expect(await store.deleteDispatchedOutboxBatch({ before: cutoff, limit: 2 })).toBe(2);
        expect(await store.deleteDispatchedOutboxBatch({ before: cutoff, limit: 2 })).toBe(1);
        expect(await store.deleteDispatchedOutboxBatch({ before: cutoff, limit: 2 })).toBe(0);
      });
    });
  });
});

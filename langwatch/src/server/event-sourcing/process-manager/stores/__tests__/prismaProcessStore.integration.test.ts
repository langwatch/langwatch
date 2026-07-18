import { nanoid } from "nanoid";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import type { JsonValue } from "../../json";
import type { ProcessRef } from "../../processManager.types";
import type { NewOutboxMessage, ProcessCommit } from "../processStore.types";
import { PrismaProcessStore } from "../prismaProcessStore";

const store = new PrismaProcessStore(prisma);
let processName: string;

function ref(
  processKey = "conversation-1",
  projectId = "project-1",
): ProcessRef {
  return { processName, projectId, processKey };
}

function message(
  messageKey: string,
  overrides: Partial<NewOutboxMessage> = {},
): NewOutboxMessage {
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
  await prisma.processManagerOutbox.deleteMany({ where });
  await prisma.processManagerInbox.deleteMany({ where });
  await prisma.processManagerInstance.deleteMany({ where });
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

    expect(results.map((result) => result.outcome).sort()).toEqual([
      "committed",
      "duplicateEvent",
    ]);
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
    expect(
      (await store.findMessagesByRef({ ref: ref() })).map(
        (row) => row.messageKey,
      ),
    ).toEqual(["message-1"]);
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
    const conflictIndex = results.findIndex(
      (result) => result.outcome === "revisionConflict",
    );
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

  it("rejects a stale acknowledgement after expiry and re-lease", async () => {
    const base = 1_700_000_000_000;
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

    const identity = {
      processName,
      projectId: "project-1",
      messageKey: "message-1",
    };
    await store.markDispatched({
      identity,
      leaseToken: first.leaseToken,
      now: base + 101,
    });
    await store.markFailed({
      identity,
      leaseToken: first.leaseToken,
      now: base + 102,
      nextAttemptAt: base + 1_000,
      dead: true,
    });

    expect(await store.findMessagesByRef({ ref: ref() })).toEqual([
      expect.objectContaining({
        status: "pending",
        attempts: 0,
        leaseToken: second.leaseToken,
      }),
    ]);

    await store.markDispatched({
      identity,
      leaseToken: second.leaseToken,
      now: base + 103,
    });
    expect(await store.findMessagesByRef({ ref: ref() })).toEqual([
      expect.objectContaining({
        status: "dispatched",
        attempts: 1,
        leaseToken: null,
      }),
    ]);
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
    const successLease = initialLeases.find(
      (row) => row.messageKey === "success",
    )!;

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
    await store.commit(
      commit({ target: ref("due"), nextWakeAt: 1_500, messages: [] }),
    );
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
});

/**
 * @vitest-environment node
 * The run's own deadline, which the installed module fixes at ten minutes: here it is a few
 * milliseconds, over a turn that never settles.
 * @see modules/insight/specs/insight-daily-run.feature
 */

import type { AnalyticsApi } from "@langwatch/analytics-contract";
import { InMemoryProcessStore, type ProcessStore } from "@langwatch/eventing";
import {
  INSIGHT_RUN_FINDINGS_FENCE_TAG,
  type InsightRunSettledEventData,
} from "@langwatch/insight-contract";
import type { LangyApi } from "@langwatch/langy-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import {
  INITIAL_INSIGHT_DAILY_RUN_STATE,
  INSIGHT_DAILY_RUN_PROCESS_NAME,
} from "../../eventing/insight-daily-run.process.ts";
import type { InsightRepository } from "../../repositories/insight.repository.ts";
import type { InsightCommandsService } from "../insight-commands.service.ts";
import type { InsightDailyRunCommandsService } from "../insight-daily-run-commands.service.ts";
import { InsightDailyRunMetricsService } from "../insight-daily-run-metrics.service.ts";
import { InsightDailyRunService } from "../insight-daily-run.service.ts";
import type { InsightRunGateService } from "../insight-run-gate.service.ts";
import type { InsightRunQueryService } from "../insight-run-query.service.ts";

const BOARD = { kind: "dashboard", id: "dashboard-1", name: "Costs" } as const;
const RUN = {
  projectId: "project-1",
  scheduleId: "schedule-1",
  userId: "user-1",
  board: BOARD,
  maxInsights: 3 as const,
  runId: "run-1",
  slot: Date.UTC(2026, 9, 10, 9, 37),
  isFinalAttempt: false,
};

type Langy = Pick<LangyApi, "startUnattendedTurn" | "awaitTurnSettlement" | "stopTurn">;

/** A turn that never settles: the wait ends only when the caller's signal does. */
const neverSettles: Langy["awaitTurnSettlement"] = ({ signal }) =>
  new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve({ kind: "stopped" }), { once: true });
  });

const SCHEDULE_REF = {
  processName: INSIGHT_DAILY_RUN_PROCESS_NAME,
  projectId: RUN.projectId,
  processKey: RUN.scheduleId,
};

/** Leaves the schedule's process instance as its handlers would, waiting on the given run. */
async function waitOn({ store, runId }: { store: ProcessStore; runId: string }): Promise<void> {
  await commitState({
    store,
    state: {
      ...INITIAL_INSIGHT_DAILY_RUN_STATE,
      pendingRun: { runId, since: RUN.slot, slot: RUN.slot },
    },
  });
}

async function commitState({ store, state }: { store: ProcessStore; state: unknown }) {
  const existing = await store.findByRef({ ref: SCHEDULE_REF });
  const expectedRevision = existing?.revision ?? 0;
  await store.commit({
    ref: SCHEDULE_REF,
    tenantId: RUN.projectId,
    sourceEventId: `event-${expectedRevision}`,
    expectedRevision,
    state,
    nextWakeAt: null,
    messages: [],
    now: RUN.slot,
  });
}

/** A turn during which a newer run takes the schedule over, then ends at the deadline. */
function takenOverDuring({
  store,
  settle = neverSettles,
}: {
  store: ProcessStore;
  settle?: Langy["awaitTurnSettlement"];
}): Langy["awaitTurnSettlement"] {
  return async (input) => {
    await waitOn({ store, runId: "run-2" });
    return settle(input);
  };
}

/** A turn that answers one finding at once, in the fenced block a run reads. */
const answersOneFinding: Langy["awaitTurnSettlement"] = async ({ turnId }) => {
  const finding = { title: "Checkout cost doubled", body: "Cost rose to 96.", tone: "bad" };
  const fence = "```";
  const block = JSON.stringify({ findings: [finding] });
  const text = [
    "I read the board.",
    "",
    `${fence}${INSIGHT_RUN_FINDINGS_FENCE_TAG}`,
    block,
    fence,
  ].join("\n");
  return {
    kind: "settled",
    settlement: {
      succeeded: true,
      outcome: "completed",
      text,
      messageId: `message-of-${turnId}`,
      parts: [{ type: "text", text }],
      error: null,
    },
  };
};

function harness({
  stopTurn,
  awaitTurnSettlement = neverSettles,
}: { stopTurn?: Langy["stopTurn"]; awaitTurnSettlement?: Langy["awaitTurnSettlement"] } = {}) {
  const started: unknown[] = [];
  const settled: InsightRunSettledEventData[] = [];
  const stopped: unknown[] = [];
  const filed: unknown[] = [];
  const service = InsightDailyRunService.create({
    gate: createApiFixture<Pick<InsightRunGateService, "check">>({
      check: async () => ({
        ok: true,
        board: { id: BOARD.id, name: BOARD.name },
        widgets: [{ id: "widget-cost", name: "Cost per day", queries: [] }],
      }),
    }),
    langy: createApiFixture<Langy>({
      startUnattendedTurn: async () => ({ conversationId: "conversation-1", turnId: "turn-1" }),
      awaitTurnSettlement,
      stopTurn:
        stopTurn ??
        (async (input) => {
          stopped.push(input);
        }),
    }),
    insights: createApiFixture<Pick<InsightRepository, "findForReader">>({
      findForReader: async () => [],
    }),
    traces: createApiFixture<Pick<AnalyticsApi, "findLastOccurredAt">>({
      findLastOccurredAt: async ({ since }) => [since],
    }),
    metrics: InsightDailyRunMetricsService.create(),
    queries: createApiFixture<Pick<InsightRunQueryService, "keepValid">>({
      keepValid: async ({ findings }) => [...findings],
    }),
    insightCommands: createApiFixture<Pick<InsightCommandsService, "fileInsight" | "renewInsight">>(
      {
        fileInsight: async (input) => void filed.push(input),
      },
    ),
    runCommands: createApiFixture<
      Pick<InsightDailyRunCommandsService, "recordRunStarted" | "settleRun" | "turnOffSchedule">
    >({
      recordRunStarted: async (input) => void started.push(input),
      settleRun: async ({ tenantId: _tenantId, occurredAt: _occurredAt, ...data }) => {
        settled.push(data);
      },
    }),
    turnDeadlineMs: 20,
  });
  return { service, started, settled, stopped, filed };
}

describe("given Langy's turn outlasts the run's deadline", () => {
  /** @scenario "A turn that does not finish in time is stopped and recorded as failed" */
  it("stops the turn and records the run as failed with the reason timeout", async () => {
    const { service, settled, stopped, filed } = harness();

    await service.run(RUN);

    expect(stopped).toEqual([
      {
        projectId: "project-1",
        userId: "user-1",
        conversationId: "conversation-1",
        turnId: "turn-1",
      },
    ]);
    expect(settled).toEqual([
      {
        scheduleId: "schedule-1",
        userId: "user-1",
        board: BOARD,
        runId: "run-1",
        slot: RUN.slot,
        outcome: "failed",
        reason: "timeout",
        filedCount: 0,
        renewedCount: 0,
        conversationId: "conversation-1",
        idLayout: "v2",
      },
    ]);
    expect(filed).toEqual([]);
  });

  /** @scenario "A new run's outcome records the v2 key layout" */
  it("names the v2 key layout on the outcome it records", async () => {
    const { service, settled } = harness();

    await service.run(RUN);

    expect(settled.map(({ idLayout }) => idLayout)).toEqual(["v2"]);
  });

  it("records the outcome even when the turn cannot be stopped", async () => {
    const { service, settled } = harness({
      stopTurn: async () => {
        throw new Error("the worker is gone");
      },
    });

    await service.run(RUN);

    expect(settled).toEqual([expect.objectContaining({ outcome: "failed", reason: "timeout" })]);
  });
});

describe("given a newer run took the run over before it started its turn", () => {
  /** @scenario "A run handed on to a newer run before its turn records no start" */
  it("records neither its start nor its outcome, and stops its turn", async () => {
    const { service, started, settled, stopped } = harness();
    const store = InMemoryProcessStore.createForTesting();
    await waitOn({ store, runId: "run-2" });
    service.connect(store);

    await service.run(RUN);

    expect(started).toEqual([]);
    expect(settled).toEqual([]);
    expect(stopped).toEqual([expect.objectContaining({ turnId: "turn-1" })]);
  });
});

describe("given a newer run took the run over while its turn ran", () => {
  /** @scenario "A run handed on to a newer run before its outcome records no outcome" */
  it("records its start, and no outcome", async () => {
    const store = InMemoryProcessStore.createForTesting();
    await waitOn({ store, runId: "run-1" });
    const { service, started, settled } = harness({
      awaitTurnSettlement: takenOverDuring({ store }),
    });
    service.connect(store);

    await service.run(RUN);

    expect(started).toEqual([expect.objectContaining({ runId: "run-1" })]);
    expect(settled).toEqual([]);
  });
});

describe("given the schedule's process still waits on the run", () => {
  /** @scenario "A run the schedule still waits on records its start and its outcome" */
  it("records its start and its outcome", async () => {
    const { service, started, settled } = harness();
    const store = InMemoryProcessStore.createForTesting();
    await waitOn({ store, runId: "run-1" });
    service.connect(store);

    await service.run(RUN);

    expect(started).toEqual([expect.objectContaining({ runId: "run-1" })]);
    expect(settled).toEqual([expect.objectContaining({ runId: "run-1", reason: "timeout" })]);
  });
});

describe("given the process store cannot be read when the run ends", () => {
  /** @scenario "A run whose schedule cannot be read still records its outcome" */
  it("still records the run's outcome as failed with the reason timeout", async () => {
    const store = InMemoryProcessStore.createForTesting();
    await commitState({ store, state: { pendingRun: "not a run" } });
    const { service, settled } = harness();
    service.connect(store);

    await service.run(RUN);

    expect(settled).toEqual([expect.objectContaining({ runId: "run-1", reason: "timeout" })]);
  });
});

describe("given a newer run took the run over before its answer was filed", () => {
  /** @scenario "A run handed on to a newer run during its turn files nothing" */
  it("files nothing and records no outcome", async () => {
    const store = InMemoryProcessStore.createForTesting();
    await waitOn({ store, runId: "run-1" });
    const { service, started, settled, filed } = harness({
      awaitTurnSettlement: takenOverDuring({ store, settle: answersOneFinding }),
    });
    service.connect(store);

    await service.run(RUN);

    expect(started).toEqual([expect.objectContaining({ runId: "run-1" })]);
    expect(filed).toEqual([]);
    expect(settled).toEqual([]);
  });
});

describe("given a run that replaces a lost one", () => {
  const SUPERSEDING = { ...RUN, supersedes: { runId: "run-0", slot: RUN.slot - 86_400_000 } };

  it("records the lost run as timed out while the process waits on this run", async () => {
    const { service, settled } = harness();
    const store = InMemoryProcessStore.createForTesting();
    await waitOn({ store, runId: "run-1" });
    service.connect(store);

    await service.run(SUPERSEDING);

    expect(settled[0]).toMatchObject({ runId: "run-0", outcome: "failed", reason: "timeout" });
  });

  it("records the lost run and this run each with its own start", async () => {
    const { service, started, settled } = harness();
    const store = InMemoryProcessStore.createForTesting();
    await waitOn({ store, runId: "run-1" });
    service.connect(store);
    const supersedes = { ...SUPERSEDING.supersedes, since: 1_000 };

    await service.run({ ...SUPERSEDING, since: 2_000, supersedes });

    expect(started).toEqual([expect.objectContaining({ runId: "run-1", since: 2_000 })]);
    expect(settled).toEqual([
      expect.objectContaining({ runId: "run-0", since: 1_000 }),
      expect.objectContaining({ runId: "run-1", since: 2_000 }),
    ]);
  });

  /** @scenario "A replacement handed on records nothing for the run it replaced" */
  it("records nothing for the lost run once the process waits on another run", async () => {
    const { service, settled } = harness();
    const store = InMemoryProcessStore.createForTesting();
    await waitOn({ store, runId: "run-2" });
    service.connect(store);

    await service.run(SUPERSEDING);

    expect(settled).toEqual([]);
  });
});

/**
 * @vitest-environment node
 * The run's own deadline, which the installed module fixes at ten minutes: here it is a few
 * milliseconds, over a turn that never settles.
 * @see modules/insight/specs/insight-daily-run.feature
 */

import type { AnalyticsApi } from "@langwatch/analytics-contract";
import { InMemoryProcessStore, type ProcessRef, type ProcessStore } from "@langwatch/eventing";
import {
  INSIGHT_RUN_FINDINGS_FENCE_TAG,
  type InsightRunSettledEventData,
} from "@langwatch/insight-contract";
import type { LangyApi } from "@langwatch/langy-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { INITIAL_INSIGHT_DAILY_RUN_STATE } from "../../eventing/insight-daily-run.process.ts";
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

/** The run the schedule's process waits on, read by read; the last answer stands. */
function processWaitingOn(pendingRunIds: readonly string[]): Pick<ProcessStore, "findByRef"> {
  const answers = [...pendingRunIds];
  // Assigned over a store, as `findByRef` is generic in the state it answers.
  return Object.assign(InMemoryProcessStore.createForTesting(), {
    findByRef: async ({ ref }: { ref: ProcessRef }) => {
      const runId = answers.length > 1 ? answers.shift()! : answers[0]!;
      const pendingRun = { runId, since: RUN.slot, slot: RUN.slot };
      const state = { ...INITIAL_INSIGHT_DAILY_RUN_STATE, pendingRun };
      return { ref, tenantId: ref.projectId, state, revision: 1, nextWakeAt: null, updatedAt: 0 };
    },
  });
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
  it("records neither its start nor its outcome, and stops its turn", async () => {
    const { service, started, settled, stopped } = harness();
    service.connect(processWaitingOn(["run-2"]));

    await service.run(RUN);

    expect(started).toEqual([]);
    expect(settled).toEqual([]);
    expect(stopped).toEqual([expect.objectContaining({ turnId: "turn-1" })]);
  });
});

describe("given a newer run took the run over while its turn ran", () => {
  it("records its start, and no outcome", async () => {
    const { service, started, settled } = harness();
    service.connect(processWaitingOn(["run-1", "run-2"]));

    await service.run(RUN);

    expect(started).toEqual([expect.objectContaining({ runId: "run-1" })]);
    expect(settled).toEqual([]);
  });
});

describe("given the schedule's process still waits on the run", () => {
  it("records its start and its outcome", async () => {
    const { service, started, settled } = harness();
    service.connect(processWaitingOn(["run-1"]));

    await service.run(RUN);

    expect(started).toEqual([expect.objectContaining({ runId: "run-1" })]);
    expect(settled).toEqual([expect.objectContaining({ runId: "run-1", reason: "timeout" })]);
  });
});

describe("given a newer run took the run over before its answer was filed", () => {
  it("files nothing and records no outcome", async () => {
    const { service, started, settled, filed } = harness({
      awaitTurnSettlement: answersOneFinding,
    });
    service.connect(processWaitingOn(["run-1", "run-2"]));

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
    service.connect(processWaitingOn(["run-1"]));

    await service.run(SUPERSEDING);

    expect(settled[0]).toMatchObject({ runId: "run-0", outcome: "failed", reason: "timeout" });
  });

  it("records the lost run and this run each with its own start", async () => {
    const { service, started, settled } = harness();
    service.connect(processWaitingOn(["run-1"]));
    const supersedes = { ...SUPERSEDING.supersedes, since: 1_000 };

    await service.run({ ...SUPERSEDING, since: 2_000, supersedes });

    expect(started).toEqual([expect.objectContaining({ runId: "run-1", since: 2_000 })]);
    expect(settled).toEqual([
      expect.objectContaining({ runId: "run-0", since: 1_000 }),
      expect.objectContaining({ runId: "run-1", since: 2_000 }),
    ]);
  });

  it("records nothing for the lost run once the process waits on another run", async () => {
    const { service, settled } = harness();
    service.connect(processWaitingOn(["run-2"]));

    await service.run(SUPERSEDING);

    expect(settled).toEqual([]);
  });
});

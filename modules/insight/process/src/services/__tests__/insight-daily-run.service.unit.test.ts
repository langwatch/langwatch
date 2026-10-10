/**
 * @vitest-environment node
 * The run's own deadline, which the installed module fixes at ten minutes: here it is a few
 * milliseconds, over a turn that never settles.
 * @see modules/insight/specs/insight-daily-run.feature
 */

import type { InsightRunSettledEventData } from "@langwatch/insight-contract";
import type { LangyApi } from "@langwatch/langy-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import type { InsightRepository } from "../../repositories/insight.repository.ts";
import type { InsightCommandsService } from "../insight-commands.service.ts";
import type { InsightDailyRunCommandsService } from "../insight-daily-run-commands.service.ts";
import { InsightDailyRunService } from "../insight-daily-run.service.ts";
import type { InsightRunGateService } from "../insight-run-gate.service.ts";

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

function harness({ stopTurn }: { stopTurn?: Langy["stopTurn"] } = {}) {
  const settled: InsightRunSettledEventData[] = [];
  const stopped: unknown[] = [];
  const filed: unknown[] = [];
  const service = InsightDailyRunService.create({
    gate: createApiFixture<Pick<InsightRunGateService, "check">>({
      check: async () => ({
        ok: true,
        board: { id: BOARD.id, name: BOARD.name },
        widgets: [{ id: "widget-cost", name: "Cost per day" }],
      }),
    }),
    langy: createApiFixture<Langy>({
      startUnattendedTurn: async () => ({ conversationId: "conversation-1", turnId: "turn-1" }),
      awaitTurnSettlement: neverSettles,
      stopTurn:
        stopTurn ??
        (async (input) => {
          stopped.push(input);
        }),
    }),
    insights: createApiFixture<Pick<InsightRepository, "findForReader">>({
      findForReader: async () => [],
    }),
    insightCommands: createApiFixture<Pick<InsightCommandsService, "fileInsight">>({
      fileInsight: async (input) => void filed.push(input),
    }),
    runCommands: createApiFixture<
      Pick<InsightDailyRunCommandsService, "recordRunStarted" | "settleRun">
    >({
      recordRunStarted: async () => undefined,
      settleRun: async ({ tenantId: _tenantId, occurredAt: _occurredAt, ...data }) => {
        settled.push(data);
      },
    }),
    turnDeadlineMs: 20,
  });
  return { service, settled, stopped, filed };
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
        conversationId: "conversation-1",
      },
    ]);
    expect(filed).toEqual([]);
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

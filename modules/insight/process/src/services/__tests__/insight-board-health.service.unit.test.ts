/**
 * @vitest-environment node
 * The board check's wait for a full query window, which the installed module makes in real
 * seconds: here the wait moves a fake clock.
 * @see modules/insight/specs/insight-board-health.feature
 */

import type { AnalyticsApi, LangWatchQLExecuteInput } from "@langwatch/analytics-contract";
import { HandledError } from "@langwatch/handled-error";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { InsightRepository } from "../../repositories/insight.repository.ts";
import { InsightBoardHealthService } from "../insight-board-health.service.ts";
import type { InsightCommandsService } from "../insight-commands.service.ts";
import { InsightDailyRunMetricsService } from "../insight-daily-run-metrics.service.ts";

const START = Date.UTC(2026, 9, 19, 9, 12);
const CALLER = {
  project: { id: "project-1", lwqlKey: "key" },
  protections: { catalogue: { permissions: [] } },
};

class WindowFull extends HandledError {
  constructor() {
    super("lwql_rate_limited", "full", {
      httpStatus: 429,
      fault: "customer",
      meta: { retryAfterSeconds: 20 },
    });
  }
}

function harness({
  fullFor,
  store = {},
}: {
  fullFor: number;
  store?: Partial<{ readFails: boolean; writeFails: boolean }>;
}) {
  const started: { sql: string; at: number }[] = [];
  const waits: number[] = [];
  const filed: unknown[] = [];
  let refusals = 0;
  const service = InsightBoardHealthService.create({
    analytics: createApiFixture<
      Pick<
        AnalyticsApi,
        | "isWorkbenchEnabled"
        | "resolveRunCaller"
        | "validateLangWatchQL"
        | "describeLangWatchQLJudgements"
        | "executeBackgroundLangWatchQL"
      >
    >({
      isWorkbenchEnabled: async () => true,
      resolveRunCaller: async () => CALLER,
      validateLangWatchQL: () => ({ parameters: [], appFunctions: [] }),
      describeLangWatchQLJudgements: () => [],
      executeBackgroundLangWatchQL: async ({ sql }: LangWatchQLExecuteInput) => {
        started.push({ sql, at: Date.now() });
        if (refusals < fullFor) {
          refusals += 1;
          throw new WindowFull();
        }
        return {
          columns: [],
          rows: [],
          statistics: { elapsedMs: 0, rowsRead: 0, bytesRead: 0, rowsReturned: 0 },
          diagnostics: [],
          followsTimeWindow: true,
          followsGranularity: true,
        };
      },
    }),
    insights: createApiFixture<Pick<InsightRepository, "findByFindingKeys">>({
      findByFindingKeys: async () => {
        if (store.readFails) throw new Error("postgres unavailable");
        return [];
      },
    }),
    commands: createApiFixture<Pick<InsightCommandsService, "fileInsight" | "renewInsight">>({
      fileInsight: async (input) => {
        if (store.writeFails) throw new Error("command bus unavailable");
        filed.push(input);
      },
    }),
    metrics: InsightDailyRunMetricsService.create(),
    pause: async (ms) => {
      waits.push(ms);
      vi.setSystemTime(Date.now() + ms);
    },
  });
  return { service, started, waits, filed };
}

const widget = (id: string) => ({ id, name: id, statements: [{ sql: `query of ${id}` }] });

const CHECK = {
  projectId: "project-1",
  userId: "user-1",
  scheduleId: "schedule-1",
  runId: "run-1",
  slot: START,
  board: { id: "dashboard-1", name: "Costs" },
  isPersonalProject: false,
  periodEnd: Date.UTC(2026, 9, 19),
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(START);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("given the project's query window refuses the check, to be retried after 20 seconds", () => {
  /** @scenario "A full query window pauses the check until it opens again" */
  it("waits 20 seconds and runs the same statement again", async () => {
    const { service, started, waits, filed } = harness({ fullFor: 1 });

    const report = await service.check({ ...CHECK, widgets: [widget("widget-1")] });

    expect(waits).toEqual([20_000]);
    expect(started).toEqual([
      { sql: "query of widget-1", at: START },
      { sql: "query of widget-1", at: START + 20_000 },
    ]);
    expect(report.filedCount).toBe(1);
    expect(filed).toHaveLength(1);
  });

  it("starts no statement after 3 minutes, and files nothing for the widgets left", async () => {
    const { service, started, waits, filed } = harness({ fullFor: 100 });

    const report = await service.check({
      ...CHECK,
      widgets: [widget("widget-1"), widget("widget-2")],
    });

    expect(started.every(({ at }) => at < START + 180_000)).toBe(true);
    expect(started.map(({ sql }) => sql).every((sql) => sql === "query of widget-1")).toBe(true);
    expect(waits.reduce((total, ms) => total + ms, 0)).toBeLessThan(180_000);
    expect(report).toEqual({ filedCount: 0, renewedCount: 0, reported: [] });
    expect(filed).toEqual([]);
  });
});

describe("given a widget that shows no data", () => {
  /** @scenario "A failed read or write of the cards leaves the run to carry on" */
  it.each([
    ["read", { readFails: true }],
    ["write", { writeFails: true }],
  ])("reports no card when the insights store fails to %s it", async (_step, store) => {
    const { service, filed } = harness({ fullFor: 0, store });

    const report = await service.check({ ...CHECK, widgets: [widget("widget-1")] });

    expect(report).toEqual({ filedCount: 0, renewedCount: 0, reported: [] });
    expect(filed).toEqual([]);
  });
});

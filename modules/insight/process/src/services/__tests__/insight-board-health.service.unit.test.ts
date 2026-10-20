/**
 * @vitest-environment node
 * The board check's wait for a full query window, which the installed module makes in real
 * seconds: here fake timers run the wait and move the clock with it.
 * @see modules/insight/specs/insight-board-health.feature
 */

import type { AnalyticsApi, LangWatchQLExecuteInput } from "@langwatch/analytics-contract";
import { HandledError } from "@langwatch/handled-error";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { InsightRepository } from "../../repositories/insight.repository.ts";
import { InsightMemoryStore } from "../../repositories/memory/insight-memory.store.ts";
import { MemoryInsightRepository } from "../../repositories/memory/memory.insight.repository.ts";
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
  /** `writeFailsFrom` is the first write, counted from 1, that fails, and every one after. */
  store?: Partial<{ readFails: boolean; writeFailsFrom: number }>;
}) {
  const started: { sql: string; at: number }[] = [];
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
          completeness: { state: "no_traffic", unit: "traces", total: 0, fields: [] },
        };
      },
    }),
    // The twin cannot fail, so only the outage stands in for it.
    insights: store.readFails
      ? createApiFixture<Pick<InsightRepository, "findByFindingKeys">>({
          findByFindingKeys: async () => {
            throw new Error("postgres unavailable");
          },
        })
      : MemoryInsightRepository.create({ rows: InsightMemoryStore.create() }),
    commands: createApiFixture<Pick<InsightCommandsService, "fileInsight" | "renewInsight">>({
      fileInsight: async (input) => {
        const write = filed.length + 1;
        if (store.writeFailsFrom !== undefined && write >= store.writeFailsFrom) {
          throw new Error("command bus unavailable");
        }
        filed.push(input);
      },
    }),
    metrics: InsightDailyRunMetricsService.create(),
  });
  return { service, started, filed };
}

/** Runs the check to its end, firing each wait's timer as it is set. */
async function checked(
  service: InsightBoardHealthService,
  input: Parameters<InsightBoardHealthService["check"]>[0],
) {
  const report = service.check(input);
  await vi.runAllTimersAsync();
  return report;
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
  vi.useFakeTimers({ toFake: ["Date", "setTimeout"] });
  vi.setSystemTime(START);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("given the project's query window refuses the check, to be retried after 20 seconds", () => {
  /** @scenario "A full query window pauses the check until it opens again" */
  it("waits 20 seconds and runs the same statement again", async () => {
    const { service, started, filed } = harness({ fullFor: 1 });

    const report = await checked(service, { ...CHECK, widgets: [widget("widget-1")] });

    expect(started).toEqual([
      { sql: "query of widget-1", at: START },
      { sql: "query of widget-1", at: START + 20_000 },
    ]);
    expect(report.filedCount).toBe(1);
    expect(filed).toHaveLength(1);
  });

  it("starts no statement after 3 minutes, and files nothing for the widgets left", async () => {
    const { service, started, filed } = harness({ fullFor: 100 });

    const report = await checked(service, {
      ...CHECK,
      widgets: [widget("widget-1"), widget("widget-2")],
    });

    expect(started.every(({ at }) => at < START + 180_000)).toBe(true);
    expect(started.map(({ sql }) => sql).every((sql) => sql === "query of widget-1")).toBe(true);
    expect(Date.now()).toBeLessThan(START + 180_000);
    expect(report).toEqual({ filedCount: 0, renewedCount: 0, reported: [] });
    expect(filed).toEqual([]);
  });
});

describe("given a widget that shows no data", () => {
  /** @scenario "A failed read or write of the cards leaves the run to carry on" */
  it.each([
    ["read", { readFails: true }],
    ["write", { writeFailsFrom: 1 }],
  ])("reports no card when the insights store fails to %s it", async (_step, store) => {
    const { service, filed } = harness({ fullFor: 0, store });

    const report = await checked(service, { ...CHECK, widgets: [widget("widget-1")] });

    expect(report).toEqual({ filedCount: 0, renewedCount: 0, reported: [] });
    expect(filed).toEqual([]);
  });
});

describe("given three widgets that show no data, and a store that fails the second write", () => {
  it("reports the one card filed before the failure", async () => {
    const { service, filed } = harness({ fullFor: 0, store: { writeFailsFrom: 2 } });

    const report = await checked(service, {
      ...CHECK,
      widgets: [widget("widget-1"), widget("widget-2"), widget("widget-3")],
    });

    expect(filed).toHaveLength(1);
    expect(report).toEqual({
      filedCount: 1,
      renewedCount: 0,
      reported: [{ id: "widget-1", name: "widget-1" }],
    });
  });
});

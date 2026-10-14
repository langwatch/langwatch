/**
 * @vitest-environment node
 * Automation over an Only me board, through the real report dispatcher and the memory rows.
 * Spec: modules/dashboard/specs/dashboards-v2.feature AC187.
 */
import type { AnalyticsApi } from "@langwatch/analytics-contract";
import { buildSeriesName } from "@langwatch/analytics-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { ReportSource } from "@langwatch/automation-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { TraceApi } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import {
  createTestSlackDestinations,
  OneProject,
  RecordingDelivery,
} from "../../__tests__/testing.ts";
import { ReportDispatcherService } from "../../features/report/services/report-dispatcher.service.ts";
import { MemoryAutomationStore } from "../../repositories/memory/memory.automation.store.ts";
import { MemoryCustomGraphRepository } from "../../repositories/memory/memory.custom-graph.repository.ts";
import { MemoryTriggerFireHistoryRepository } from "../../repositories/memory/memory.trigger-fire-history.repository.ts";
import { MemoryTriggerRepository } from "../../repositories/memory/memory.trigger.repository.ts";
import { AutomationRulesService } from "../automation-rules.service.ts";
import type { AutomationService } from "../automation.service.ts";

const PROJECT = "project-1";
const ONLY_ME_BOARD = "board-only-me";
const PROJECT_BOARD = "board-project";
const SLOT = new Date("2026-07-15T09:00:00Z").getTime();
const SERIES = {
  metric: "metadata.trace_id",
  aggregation: "cardinality",
  name: "Traces",
  colorSet: "colors",
};

/** The email bodies a report left with, beside what the shared fixture records. */
class ReadableDelivery extends RecordingDelivery {
  readonly bodies: string[] = [];

  override async sendEmail(input: Parameters<RecordingDelivery["sendEmail"]>[0]): Promise<void> {
    this.bodies.push(input.html);
    await super.sendEmail(input);
  }
}

/** One graph on each board and one on none, with the Only me board named to the store. */
function world() {
  const store = MemoryAutomationStore.create();
  const graph = (id: string, name: string, dashboardId: string | null) =>
    store.customGraphs.push({
      id,
      projectId: PROJECT,
      name,
      filters: {},
      dashboardId,
      graph: {
        graphId: id,
        graphType: "line",
        series: [SERIES],
        includePrevious: false,
        timeScale: 60,
      },
    });
  graph("graph-only-me", "Secret revenue", ONLY_ME_BOARD);
  graph("graph-project", "Traces per hour", PROJECT_BOARD);
  graph("graph-unplaced", "Unplaced", null);
  store.privateDashboardIds.add(ONLY_ME_BOARD);

  const getTimeseries = vi.fn(async () => ({
    previousPeriod: [],
    currentPeriod: [{ date: "2026-07-15T08:00:00Z", [buildSeriesName(SERIES as never, 0)]: 42 }],
  }));
  const delivery = new ReadableDelivery();
  const repositories = {
    triggers: MemoryTriggerRepository.create(store),
    history: MemoryTriggerFireHistoryRepository.create(store),
    customGraphs: MemoryCustomGraphRepository.create(store),
  };
  const dispatcher = ReportDispatcherService.create({
    repositories,
    projects: new OneProject(),
    analytics: createApiFixture<AnalyticsApi>({ getTimeseries }),
    traces: createApiFixture<TraceApi>({}),
    authz: createApiFixture<AuthzApi>({}),
    delivery,
    slackDestinations: createTestSlackDestinations(),
    suppression: { filterSuppressed: async ({ emails }) => emails },
    baseHost: "https://app.langwatch.test",
  });

  /** Saves a report on the source and fires it once; the email body it sent, less its own id. */
  const send = async (source: ReportSource): Promise<string | undefined> => {
    const id = `report-${delivery.bodies.length}`;
    await repositories.triggers.create({
      id,
      projectId: PROJECT,
      name: "Weekly report",
      action: "SEND_EMAIL",
      actionParams: {
        source,
        schedule: { cron: "0 9 * * *", timezone: "UTC" },
        compareToPrevious: false,
        members: ["teammate@example.com"],
      },
      filters: {},
    });
    await repositories.triggers.update({ id, projectId: PROJECT, triggerKind: "REPORT" });
    await dispatcher.dispatch({ projectId: PROJECT, triggerId: id, slot: SLOT });
    return delivery.bodies.at(-1)?.replaceAll(id, "<report>");
  };

  return { store, repositories, send, getTimeseries, fires: store.fires };
}

/** A body with the ids its author typed taken out, so two reports compare by what they show. */
const withoutIds = (body: string | undefined, ...ids: string[]) =>
  ids.reduce((text, id) => text?.replaceAll(id, "<id>"), body);

describe("given a builder graph on a board its author set to Only me", () => {
  describe("when a scheduled report on that board is sent", () => {
    /** @scenario "AC187 Scope: an alert or a scheduled report reads nothing from an Only me board" */
    it("sends what a report on a board that does not exist sends, with no chart from it", async () => {
      const { send, getTimeseries, fires } = world();

      const hidden = await send({ kind: "dashboard", dashboardId: ONLY_ME_BOARD });
      const missing = await send({ kind: "dashboard", dashboardId: "no-such-board" });

      expect(withoutIds(hidden, ONLY_ME_BOARD)).toEqual(withoutIds(missing, "no-such-board"));
      expect({
        namesTheGraph: hidden?.includes("Secret revenue"),
        saysNothingToShow: hidden?.includes("Nothing to show for this period"),
        queriedItsData: getTimeseries.mock.calls.length,
        firesRecorded: fires.length,
      }).toEqual({
        namesTheGraph: false,
        saysNothingToShow: true,
        queriedItsData: 0,
        firesRecorded: 2,
      });
    });

    /** @scenario "AC187 Scope: an alert or a scheduled report reads nothing from an Only me board" */
    it("sends what a report on a graph that does not exist sends, when it names the graph", async () => {
      const { send, getTimeseries } = world();

      const hidden = await send({ kind: "customGraph", customGraphId: "graph-only-me" });
      const missing = await send({ kind: "customGraph", customGraphId: "no-such-graph" });

      expect(withoutIds(hidden, "graph-only-me")).toEqual(withoutIds(missing, "no-such-graph"));
      expect({
        namesTheGraph: hidden?.includes("Secret revenue"),
        queriedItsData: getTimeseries.mock.calls.length,
      }).toEqual({ namesTheGraph: false, queriedItsData: 0 });
    });

    /** @scenario "AC187 Scope: an alert or a scheduled report reads nothing from an Only me board" */
    it("still sends every panel of a board the project shares", async () => {
      const { send } = world();

      const shared = await send({ kind: "dashboard", dashboardId: PROJECT_BOARD });

      expect(shared).toContain("Traces per hour");
    });

    /** @scenario "AC187 Scope: an alert or a scheduled report reads nothing from an Only me board" */
    it("sends the board's panels again once its author widens it", async () => {
      const { send, store } = world();
      store.privateDashboardIds.delete(ONLY_ME_BOARD);

      const widened = await send({ kind: "dashboard", dashboardId: ONLY_ME_BOARD });

      expect(widened).toContain("Secret revenue");
    });
  });

  describe("when an alert is attached to that graph", () => {
    /** @scenario "AC187 Scope: an alert or a scheduled report reads nothing from an Only me board" */
    it("is refused as a graph the project does not have", async () => {
      const { repositories } = world();
      const rules = AutomationRulesService.create({
        automation: createApiFixture<AutomationService>({
          customGraphExistsInProject: (input) => repositories.customGraphs.existsInProject(input),
        }),
        projects: createApiFixture<ProjectApi>({}),
      });
      const refusal = async (customGraphId: string) => {
        const refused = await rules
          .assertCustomGraphInProject({ customGraphId, projectId: PROJECT })
          .then(() => undefined)
          .catch((error: unknown) => error as Error & { serialize(): unknown });
        return withoutIds(
          JSON.stringify({ message: refused?.message, ...Object(refused?.serialize()) }),
          customGraphId,
        );
      };

      expect({
        hidden: await refusal("graph-only-me"),
        unplaced: await refusal("graph-unplaced"),
        onProjectBoard: await refusal("graph-project"),
      }).toEqual({
        hidden: await refusal("no-such-graph"),
        unplaced: "{}",
        onProjectBoard: "{}",
      });
    });
  });
});

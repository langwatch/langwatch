/**
 * @vitest-environment jsdom
 */
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeAutomationHost, renderWithAutomationHost } from "../../../testing.tsx";
import { ViewAutomationDrawer } from "../ui/sections/view-automation-drawer.tsx";
import type * as ViewDrawerFixture from "./view-drawer.fixture.ts";
import {
  GRAPH_ALERT_ROW,
  resetViewDrawerState,
  TRACE_AUTOMATION_ROW,
  viewDrawerState,
} from "./view-drawer.fixture.ts";

vi.mock("../../../behavior/automation-session.ts", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-1", name: "Proj", slug: "proj" },
    organization: { id: "org-1" },
    team: { slug: "team-1" },
  }),
}));

vi.mock("../../../ui/elements/filter-display.tsx", () => ({
  FilterDisplay: ({ filters }: { filters: string }) => (
    <div data-testid="filter-display">{filters}</div>
  ),
}));

vi.mock("../../../behavior/automation-api.ts", async () => {
  const fixture = await vi.importActual<typeof ViewDrawerFixture>("./view-drawer.fixture.ts");
  return { api: fixture.viewDrawerApi() };
});

vi.mock("../../../behavior/slack-api.ts", async () => {
  const fixture = await vi.importActual<typeof ViewDrawerFixture>("./view-drawer.fixture.ts");
  return { slackApi: fixture.viewDrawerSlackApi() };
});

const onClose = vi.fn();
const onEdit = vi.fn();

function renderDrawer() {
  return renderWithAutomationHost(
    <ViewAutomationDrawer automationId="trigger_1" onClose={onClose} onEdit={onEdit} />,
    { host: fakeAutomationHost() },
  );
}

const MINUTE_MS = 60 * 1000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

const evaluation = (fields: Record<string, unknown>) => ({
  triggerId: "trigger_1",
  projectId: "project-1",
  observedValue: null,
  threshold: 100,
  operator: "gt",
  timePeriodMinutes: 60,
  skipCode: null,
  ...fields,
});

describe("ViewAutomationDrawer history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-06-01T12:00:00.000Z"));
    resetViewDrawerState();
    viewDrawerState.nextFiring = { kind: "alert", sweepIntervalMs: 30_000 };
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  describe("given a report that has not been sent yet", () => {
    describe("when the drawer renders", () => {
      /** @scenario "A report that has not been sent yet says it sends on its schedule" */
      it("says it sends on its schedule and never mentions matching traces", () => {
        viewDrawerState.trigger = {
          ...TRACE_AUTOMATION_ROW,
          name: "Weekly quality report",
          filterQuery: null,
          triggerKind: "REPORT",
        };
        renderDrawer();

        expect(
          screen.getByText("This report has not been sent yet. It sends on its schedule."),
        ).toBeDefined();
        expect(screen.queryByText(/traces that match/)).toBeNull();
      });
    });
  });

  describe("given a trace automation whose fire history fails to load", () => {
    describe("when the drawer renders", () => {
      it("says the history couldn't load instead of claiming it never fired", () => {
        viewDrawerState.trigger = TRACE_AUTOMATION_ROW;
        viewDrawerState.fireHistoryFails = true;
        renderDrawer();

        expect(screen.getByText("Couldn't load this automation's history.")).toBeInTheDocument();
        expect(screen.queryByText(/has not fired yet/)).toBeNull();
      });
    });
  });

  describe("given an alert whose last evaluation fails to load", () => {
    describe("when the drawer renders", () => {
      it("says the history couldn't load instead of claiming it was never checked", () => {
        viewDrawerState.trigger = GRAPH_ALERT_ROW;
        viewDrawerState.evaluationFails = true;
        renderDrawer();

        expect(screen.getByText("Couldn't load this automation's history.")).toBeInTheDocument();
        expect(screen.queryByText(/has not been checked yet/)).toBeNull();
      });
    });
  });

  describe("given an alert whose last check did not cross its threshold", () => {
    describe("when the drawer renders", () => {
      /** @scenario The view shows the last evaluation with observed value vs threshold */
      it("says when it was checked, what it observed, and that it did not fire", () => {
        viewDrawerState.trigger = GRAPH_ALERT_ROW;
        viewDrawerState.latestEvaluation = evaluation({
          evaluatedAt: ago(5 * MINUTE_MS),
          verdict: "not_breached",
          observedValue: 42,
        });
        renderDrawer();

        expect(screen.getByText(/The automation did not fire/)).toBeDefined();
        expect(screen.getByText(/5 minutes ago/)).toBeDefined();
        expect(
          screen.getByText("observed 42, fires when greater than 100 over 1 hour"),
        ).toBeDefined();
      });
    });
  });

  describe("given an alert whose last check crossed its threshold", () => {
    describe("when the drawer renders", () => {
      /** @scenario An automation that crossed its threshold reads as fired */
      it("says the automation fired on that check", () => {
        viewDrawerState.trigger = GRAPH_ALERT_ROW;
        viewDrawerState.latestEvaluation = evaluation({
          evaluatedAt: ago(MINUTE_MS),
          verdict: "fired",
          observedValue: 250,
        });
        renderDrawer();

        expect(screen.getByText(/The automation fired/)).toBeDefined();
        expect(screen.getByText(/observed 250/)).toBeDefined();
      });
    });
  });

  describe("given an alert whose last check was skipped", () => {
    describe("when the graph groups by too many values", () => {
      /** @scenario A skipped evaluation names its reason */
      it("says the check was skipped and names what to change", () => {
        viewDrawerState.trigger = GRAPH_ALERT_ROW;
        viewDrawerState.latestEvaluation = evaluation({
          evaluatedAt: ago(2 * MINUTE_MS),
          verdict: "skipped",
          skipCode: "result_too_large",
        });
        renderDrawer();

        expect(screen.getByText(/The check was skipped/)).toBeDefined();
        expect(screen.getByText(/groups by a field with too many distinct values/)).toBeDefined();
      });
    });
  });

  describe("given an alert that has never been evaluated", () => {
    describe("when the drawer renders", () => {
      /** @scenario An automation that has never been evaluated says so */
      it("says it has not been checked yet", () => {
        viewDrawerState.trigger = GRAPH_ALERT_ROW;
        renderDrawer();

        expect(screen.getByText(/has not been checked yet either/)).toBeDefined();
      });
    });
  });

  describe("given a trace automation that has fired repeatedly", () => {
    describe("when the drawer renders", () => {
      it("collapses a run of same-minute fires into one counted row", () => {
        viewDrawerState.trigger = TRACE_AUTOMATION_ROW;
        viewDrawerState.fires = Array.from({ length: 3 }, (_, index) => ({
          id: `sent_${index}`,
          triggerId: "trigger_1",
          createdAt: ago(6 * MINUTE_MS),
          resolvedAt: null,
        }));
        renderDrawer();

        expect(screen.getByText("Fired 3 times")).toBeDefined();
        expect(screen.getByText(/6 minutes ago/)).toBeDefined();
        expect(screen.queryByText(/has not fired yet/)).toBeNull();
      });
    });
  });
});

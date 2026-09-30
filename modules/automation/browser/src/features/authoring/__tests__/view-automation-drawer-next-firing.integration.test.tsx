/**
 * @vitest-environment jsdom
 */
import type * as SlackKit from "@langwatch/slack-browser-kit";
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

vi.mock("@langwatch/slack-browser-kit", async (importOriginal) => {
  const fixture = await vi.importActual<typeof ViewDrawerFixture>("./view-drawer.fixture.ts");
  return { ...(await importOriginal<typeof SlackKit>()), slackApi: fixture.viewDrawerSlackApi() };
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
const fromNow = (ms: number) => new Date(Date.now() + ms).toISOString();

describe("ViewAutomationDrawer next firing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetViewDrawerState();
    viewDrawerState.nextFiring = { kind: "alert", sweepIntervalMs: 30_000 };
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  describe("given a schedule with an active calendar entry", () => {
    describe("when the drawer renders", () => {
      /** @scenario The view shows the next scheduled firing */
      it("shows the next time it sends", () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        vi.setSystemTime(new Date("2026-06-01T12:00:00.000Z"));
        viewDrawerState.trigger = {
          ...TRACE_AUTOMATION_ROW,
          triggerKind: "REPORT",
          filterQuery: null,
        };
        viewDrawerState.nextFiring = { kind: "schedule", nextRunAt: fromNow(90 * MINUTE_MS) };
        renderDrawer();

        expect(screen.getByText("Sends next on")).toBeDefined();
        expect(screen.getByText(/^in about/)).toBeDefined();
      });
    });
  });

  describe("given a paused report", () => {
    describe("when the drawer renders", () => {
      /** @scenario A paused report does not claim a next firing */
      it("says it sends nothing while it is paused, and marks it paused", () => {
        viewDrawerState.trigger = {
          ...TRACE_AUTOMATION_ROW,
          triggerKind: "REPORT",
          filterQuery: null,
          active: false,
        };
        viewDrawerState.nextFiring = { kind: "paused", subject: "schedule", pausedReason: null };
        renderDrawer();

        expect(screen.getByText("Nothing, while this report is paused")).toBeDefined();
        expect(screen.getByText(/Resume it/)).toBeDefined();
        expect(screen.getByText("Paused")).toBeDefined();
      });
    });
  });

  describe("given a paused graph-watching automation", () => {
    describe("when the drawer renders", () => {
      it("does not claim it is still being checked", () => {
        viewDrawerState.trigger = { ...GRAPH_ALERT_ROW, active: false };
        viewDrawerState.nextFiring = { kind: "paused", subject: "alert", pausedReason: null };
        renderDrawer();

        expect(screen.getByText("Nothing, while this automation is paused")).toBeDefined();
        expect(screen.queryByText("Checked as data arrives")).toBeNull();
      });
    });
  });

  describe("given an automation the platform paused for runaway volume", () => {
    describe("when the drawer renders", () => {
      it("explains what it did and what to change", () => {
        viewDrawerState.trigger = { ...TRACE_AUTOMATION_ROW, active: false };
        viewDrawerState.nextFiring = {
          kind: "paused",
          subject: "automation",
          pausedReason: "runaway_volume",
        };
        renderDrawer();

        expect(screen.getByText("Nothing, while this automation is paused")).toBeDefined();
        expect(screen.getByText(/matched almost every trace in the project/)).toBeDefined();
      });
    });
  });

  describe("given an automation that batches its notifications", () => {
    describe("when the drawer renders", () => {
      /** @scenario A digest automation shows when its next window closes */
      it("says when the next batch is sent", () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        vi.setSystemTime(new Date("2026-06-01T12:00:00.000Z"));
        viewDrawerState.trigger = TRACE_AUTOMATION_ROW;
        viewDrawerState.nextFiring = {
          kind: "digest",
          cadence: "5min_digest",
          windowClosesAt: fromNow(3 * MINUTE_MS),
        };
        renderDrawer();

        expect(screen.getByText("Sends the next batch at")).toBeDefined();
        expect(screen.getByText(/Every 5 minutes/)).toBeDefined();
      });
    });
  });

  describe("given an alert with no calendar entry of its own", () => {
    describe("when the drawer renders", () => {
      /** @scenario A graph-watching automation says how often it is checked */
      it("says the alert is checked as data arrives", () => {
        viewDrawerState.trigger = GRAPH_ALERT_ROW;
        renderDrawer();

        expect(screen.getByText("Checked as data arrives")).toBeDefined();
        expect(screen.getByText(/every 30 seconds/)).toBeDefined();
      });
    });
  });
});

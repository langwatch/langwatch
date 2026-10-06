/**
 * @vitest-environment jsdom
 * specs/automations/automations-list.feature
 * What the reports table, the automations table and the activity history say
 * about what runs next, what is firing and what already happened.
 */
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeAutomationHost, renderWithAutomationHost } from "../../../testing.tsx";
import type { AutomationSection } from "../automations-layout.tsx";
import { AutomationsPage } from "../automations-screen.tsx";
import type * as ListPagesFixture from "./list-pages.fixture.ts";

const reads = vi.hoisted(() => ({
  stats: [] as unknown[],
  schedules: [] as unknown[],
  activity: [] as unknown[],
}));

vi.mock("../../../behavior/automation-session.ts", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1", slug: "test-project", name: "Test Project" },
    organization: { id: "org-1" },
    team: { slug: "team-1" },
  }),
}));

vi.mock("../../../behavior/automation-api.ts", async () => {
  const fixture = await vi.importActual<typeof ListPagesFixture>("./list-pages.fixture.ts");
  const base = fixture.listPagesApi();
  const settled = (data: unknown) => ({ data, isLoading: false, refetch: vi.fn() });
  return {
    api: {
      ...base,
      automation: {
        ...base.automation,
        getTriggerStats: { useQuery: () => settled(reads.stats) },
        getReportSchedules: { useQuery: () => settled(reads.schedules) },
        getRecentActivity: { useQuery: () => settled(reads.activity) },
      },
    },
  };
});

vi.mock("../../../behavior/slack-api.ts", async () => {
  const fixture = await vi.importActual<typeof ListPagesFixture>("./list-pages.fixture.ts");
  return { slackApi: fixture.listPagesSlackApi() };
});

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function renderPage(section: AutomationSection) {
  const host = fakeAutomationHost({ permissions: ["triggers:manage"], query: {} });
  return renderWithAutomationHost(<AutomationsPage section={section} />, { host });
}

function rowOf({ container, triggerId }: { container: HTMLElement; triggerId: string }) {
  const row = container.querySelector<HTMLElement>(`[data-trigger-id="${triggerId}"]`);
  if (!row) throw new Error(`no row for ${triggerId}`);
  return within(row);
}

describe("given the automations pages", () => {
  beforeEach(() => {
    reads.stats = [];
    reads.schedules = [];
    reads.activity = [];
  });

  afterEach(() => {
    cleanup();
  });

  describe("when a report is scheduled", () => {
    /** @scenario "A report shows when it next runs" */
    it("shows its next run and its last run from the scheduler", () => {
      reads.schedules = [
        {
          triggerId: "schedule-1",
          nextRunAt: new Date(Date.now() + 3 * DAY),
          lastRunAt: new Date(Date.now() - 2 * HOUR),
        },
      ];

      const { container } = renderPage("reports");

      const row = rowOf({ container, triggerId: "schedule-1" });
      expect(row.getByText(/^in .*days?$/)).toBeInTheDocument();
      expect(row.getByText(/2 hours ago$/)).toBeInTheDocument();
      expect(row.queryByText("Paused")).not.toBeInTheDocument();
      expect(row.queryByText("Not yet")).not.toBeInTheDocument();
    });

    /** @scenario "A paused report shows no next run" */
    it("claims no next run time when the scheduler holds none", () => {
      reads.schedules = [{ triggerId: "schedule-1", nextRunAt: null, lastRunAt: null }];

      const { container } = renderPage("reports");

      const row = rowOf({ container, triggerId: "schedule-1" });
      expect(row.getByText("Paused")).toBeInTheDocument();
      expect(row.queryByText(/^in /)).not.toBeInTheDocument();
    });

    /** @scenario "A report that has never run" */
    it("shows when it first runs and says it has not run yet", () => {
      reads.schedules = [
        { triggerId: "schedule-1", nextRunAt: new Date(Date.now() + HOUR), lastRunAt: null },
      ];

      const { container } = renderPage("reports");

      const row = rowOf({ container, triggerId: "schedule-1" });
      expect(row.getByText(/^in .*hour$/)).toBeInTheDocument();
      expect(row.getByText("Not yet")).toBeInTheDocument();
    });
  });

  describe("when an alert is over its threshold", () => {
    /** @scenario "An alert that is currently breaching" */
    it("shows the alert as firing with when it last fired", () => {
      reads.stats = [
        {
          triggerId: "alert-1",
          lastFiredAt: new Date(Date.now() - 5 * 60 * 1000),
          recentFireCount: 1,
          currentlyFiring: true,
        },
      ];

      const { container } = renderPage("automations");

      const row = rowOf({ container, triggerId: "alert-1" });
      expect(row.getByText("Firing")).toBeInTheDocument();
      expect(row.getByText(/5 minutes ago$/)).toBeInTheDocument();
    });
  });

  describe("when an automation has fired several times", () => {
    /** @scenario "An automation that matches traces" */
    it("shows when it last fired and how often it fired recently", () => {
      reads.stats = [
        {
          triggerId: "automation-1",
          lastFiredAt: new Date(Date.now() - 3 * HOUR),
          recentFireCount: 7,
          currentlyFiring: false,
        },
      ];

      const { container } = renderPage("automations");

      const row = rowOf({ container, triggerId: "automation-1" });
      expect(row.getByText(/3 hours ago$/)).toBeInTheDocument();
      expect(row.getByText("7")).toBeInTheDocument();
    });
  });

  describe("when automations have fired", () => {
    /** @scenario "Reviewing recent activity across everything" */
    it("lists each entry by automation name, newest first, grouped by day", () => {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const threeDaysAgoNoon = new Date(startOfToday.getTime() - 3 * DAY + 12 * HOUR);
      reads.activity = [
        {
          id: "fire-old",
          triggerId: "automation-1",
          customGraphId: null,
          createdAt: new Date(threeDaysAgoNoon.getTime() - 2 * HOUR),
          resolvedAt: null,
        },
        {
          id: "fire-report",
          triggerId: "schedule-1",
          customGraphId: null,
          createdAt: threeDaysAgoNoon,
          resolvedAt: null,
        },
        {
          id: "fire-alert",
          triggerId: "alert-1",
          customGraphId: "graph-1",
          createdAt: new Date(),
          resolvedAt: null,
        },
      ];

      renderPage("overview");

      const rows = screen.getAllByTestId(/^automation-activity-/);
      expect(rows.map((row) => row.textContent)).toEqual([
        expect.stringContaining("Cost spike"),
        expect.stringContaining("Weekly digest"),
        expect.stringContaining("Flag failures"),
      ]);
      expect(screen.getByText("Today")).toBeInTheDocument();
      expect(screen.queryByText("Yesterday")).not.toBeInTheDocument();
      expect(rows[0]!.parentElement).not.toBe(rows[1]!.parentElement);
      expect(rows[1]!.parentElement).toBe(rows[2]!.parentElement);
    });
  });

  describe("when nothing has fired", () => {
    /** @scenario "Nothing has happened yet" */
    it("says so instead of showing an empty table", () => {
      renderPage("overview");

      expect(screen.getByText(/Nothing has fired yet/)).toBeInTheDocument();
      expect(screen.queryAllByTestId(/^automation-activity-/)).toHaveLength(0);
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
    });
  });
});

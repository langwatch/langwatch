/** @vitest-environment jsdom */

import { DesignSystemProvider } from "@langwatch/design-system/provider";
import type { OpsInsightSchedule } from "@langwatch/ops-contract";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { InsightSchedulesContentView } from "../ui/sections/insight-schedules-content.tsx";

const NOW = new Date("2026-10-11T12:00:00.000Z").getTime();
const at = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();
const HOUR_MS = 3_600_000;

function makeSchedule(overrides: Partial<OpsInsightSchedule> = {}): OpsInsightSchedule {
  return {
    id: "schedule-1",
    projectId: "project-1",
    projectName: "Acme",
    userId: "user-1",
    owner: "Ada Lovelace",
    boardKind: "dashboard",
    boardId: "board-1",
    boardName: "Weekly quality",
    on: true,
    offReason: null,
    hour: 9,
    timezone: "Europe/Amsterdam",
    nextRunAt: at(19 * HOUR_MS),
    lastRunAt: at(-5 * HOUR_MS),
    lastRunOutcome: "skipped",
    lastRunReason: "no_access",
    consecutiveSkips: 2,
    daysUntilOff: 5,
    ...overrides,
  };
}

function show(schedules: OpsInsightSchedule[]) {
  return render(
    <DesignSystemProvider forcedTheme="light">
      <InsightSchedulesContentView schedules={schedules} isLoading={false} now={NOW} />
    </DesignSystemProvider>,
  );
}

const rowOf = (text: string) => {
  const row = screen.getByText(text).closest("tr");
  if (!row) throw new Error(`no row holds ${text}`);
  return within(row);
};

afterEach(cleanup);

describe("InsightSchedulesContentView", () => {
  describe("given a schedule that is on, one the system turned off and one its person turned off", () => {
    const schedules = [
      makeSchedule(),
      makeSchedule({
        id: "schedule-2",
        boardName: "Costs",
        owner: "Grace Hopper",
        on: false,
        offReason: "skipped_days",
        nextRunAt: null,
        consecutiveSkips: 7,
        daysUntilOff: null,
      }),
      makeSchedule({
        id: "schedule-3",
        boardName: "Latency",
        owner: "Alan Turing",
        on: false,
        nextRunAt: null,
        lastRunOutcome: "filed",
        lastRunReason: null,
        consecutiveSkips: 0,
        daysUntilOff: null,
      }),
    ];

    /** @scenario "The Schedules page lists each daily insights schedule" */
    it("names each row's project, board and owner beside its state and runs", () => {
      show(schedules);

      const on = rowOf("Weekly quality");
      expect(on.getByText("Acme")).toBeTruthy();
      expect(on.getByText("Ada Lovelace")).toBeTruthy();
      expect(on.getByText("around 09:00 Europe/Amsterdam")).toBeTruthy();
      expect(on.getByText("Skipping")).toBeTruthy();
      expect(on.getByText(/skipped · no_access/)).toBeTruthy();
      expect(on.getByText("2 skipped, off after 5 more")).toBeTruthy();
      expect(on.queryByText("not armed")).toBeNull();

      const turnedOff = rowOf("Costs");
      expect(turnedOff.getByText("Grace Hopper")).toBeTruthy();
      expect(turnedOff.getByText("Turned off")).toBeTruthy();
      expect(turnedOff.getByText("skipped too many days in a row")).toBeTruthy();
      expect(turnedOff.getByText("7 skipped")).toBeTruthy();
      expect(turnedOff.getByText("none")).toBeTruthy();

      const off = rowOf("Latency");
      expect(off.getByText("Alan Turing")).toBeTruthy();
      expect(off.getByText("Off")).toBeTruthy();
      expect(off.getByText(/filed/)).toBeTruthy();
      expect(off.getByText("0 skipped")).toBeTruthy();
    });

    it("lists the schedule that is on before the ones that are off", () => {
      show(schedules.toReversed());

      const boards = screen
        .getAllByRole("row")
        .slice(1)
        .map((row) => row.querySelector("td")?.firstChild?.textContent);
      expect(boards).toEqual(["Weekly quality", "Costs", "Latency"]);
    });
  });

  describe("given a schedule that is on and has no wake armed", () => {
    /** @scenario "A schedule that is on with no next run is marked" */
    it("reads its next run as not armed", () => {
      show([makeSchedule({ nextRunAt: null, consecutiveSkips: 0 })]);

      const row = rowOf("Weekly quality");
      expect(row.getByText("not armed")).toBeTruthy();
      expect(row.getByText("Not armed")).toBeTruthy();
    });
  });

  describe("given a project and an owner that are gone", () => {
    it("shows their ids in place of their names", () => {
      show([makeSchedule({ projectName: null, owner: null })]);

      const row = rowOf("Weekly quality");
      expect(row.getByText("project-1")).toBeTruthy();
      expect(row.getByText("user-1")).toBeTruthy();
    });
  });

  describe("given no daily insights schedule", () => {
    /** @scenario "An empty list says nobody turned daily insights on" */
    it("says nobody has turned daily insights on yet", () => {
      show([]);

      expect(screen.getByText("Nobody has turned daily insights on for a board yet.")).toBeTruthy();
      expect(screen.queryByRole("table")).toBeNull();
    });
  });

  describe("given the list is still loading", () => {
    it("shows a spinner and no table", () => {
      render(
        <DesignSystemProvider forcedTheme="light">
          <InsightSchedulesContentView schedules={[]} isLoading={true} now={NOW} />
        </DesignSystemProvider>,
      );

      expect(screen.getByLabelText("Loading daily insights schedules")).toBeTruthy();
      expect(screen.queryByRole("table")).toBeNull();
    });
  });
});

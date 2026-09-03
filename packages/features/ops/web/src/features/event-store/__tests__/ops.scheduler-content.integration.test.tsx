/** @vitest-environment jsdom */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import type { OpsScheduledJob, SchedulerAuditEntryView } from "@langwatch/ops-contract";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SchedulerContentView } from "../ui/sections/scheduler-content";
import { UpcomingWorkCard } from "../ui/elements/upcoming-work-card";

const NOW = 1_755_100_000_000;

function makeSchedule(overrides: Partial<OpsScheduledJob> = {}): OpsScheduledJob {
  return {
    id: "schedule-1",
    projectId: "project-1",
    targetType: "briefing",
    targetId: "target-1",
    cron: "0 * * * *",
    timezone: "UTC",
    nextRunAt: new Date(NOW - 90_000).toISOString(),
    lastSlot: new Date(NOW - 10 * 60_000).toISOString(),
    active: true,
    projectName: "Ops project",
    createdAt: new Date(NOW - 86_400_000).toISOString(),
    currentSlot: null,
    attempts: 0,
    lastError: null,
    updatedAt: new Date(NOW - 90_000).toISOString(),
    ...overrides,
  };
}

const auditEntry: SchedulerAuditEntryView = {
  id: "audit-1",
  at: new Date(NOW - 5_000).toISOString(),
  action: "ops.scheduler.run_now",
  scheduleId: "schedule-1",
  projectId: "project-1",
  actor: "operator@example.com",
};

function withChakra(node: React.ReactElement) {
  return render(<ChakraProvider value={defaultSystem}>{node}</ChakraProvider>);
}

afterEach(cleanup);

describe("SchedulerContentView", () => {
  it("presents schedule health and keeps row actions at the app edge", () => {
    withChakra(
      <SchedulerContentView
        jobs={[makeSchedule()]}
        recentActions={[auditEntry]}
        isLoading={false}
        hasAccess={true}
        now={NOW}
        renderActions={(job) => <button type="button">act {job.id}</button>}
      />,
    );

    expect(screen.getByText("Overdue")).toBeTruthy();
    expect(screen.getByRole("button", { name: "act schedule-1" })).toBeTruthy();
    expect(screen.getByText(/operator@example.com ran/)).toBeTruthy();
  });
});

describe("UpcomingWorkCard", () => {
  it("merges schedules and process wakes in due order", () => {
    withChakra(
      <UpcomingWorkCard
        schedules={[makeSchedule({ nextRunAt: new Date(NOW + 60_000).toISOString() })]}
        wakes={[
          {
            processName: "automation.process",
            projectId: "project-1",
            processKey: "rule-1",
            nextWakeAt: NOW - 30_000,
          },
        ]}
        now={NOW}
      />,
    );

    expect(screen.getByText("process wake")).toBeTruthy();
    expect(screen.getByText("schedule")).toBeTruthy();
    expect(screen.getByText("30s overdue")).toBeTruthy();
  });
});

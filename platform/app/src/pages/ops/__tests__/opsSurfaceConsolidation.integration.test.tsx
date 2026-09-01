/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import OpsProjectionsPage from "../event-sourcing/projections";
import OpsSchedulesPage from "../event-sourcing/schedules";

/**
 * Where each ops surface lives after the consolidation.
 *
 * Spec: specs/ops/ops-dashboard-density.feature ("One question, one place").
 *
 * These are placement guards, not rendering guards: each card has its own
 * tests for what it draws. What is worth pinning is that the card is mounted
 * on the page whose question it answers, because that is exactly what drifted
 * — upcoming work sat on the landing page previewing a calendar two clicks
 * away, and replay history sat a floor below the button that starts a replay.
 *
 * The retired /ops/queues address forwards from the packaged route table
 * rather than from a page, so its scenario is bound in
 * `src/__tests__/retiredPageRedirects.integration.test.tsx`.
 */

const mockReplace = vi.fn();

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ replace: mockReplace, pathname: "/ops/queues" }),
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({ openDrawer: vi.fn(), closeDrawer: vi.fn() }),
}));

vi.mock("~/components/ops/event-sourcing/EventSourcingLayout", () => ({
  EventSourcingLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("~/components/ops/scheduler/UpcomingWorkCard", () => ({
  UpcomingWorkCard: () => <div>upcoming-work-card</div>,
}));
vi.mock("~/components/ops/scheduler/SchedulerContent", () => ({
  SchedulerContent: () => <div>scheduler-content</div>,
}));
vi.mock("~/components/ops/event-sourcing/ReplayHistorySection", () => ({
  ReplayHistorySection: () => <div>replay-history-section</div>,
}));
vi.mock("~/components/ops/event-sourcing/ProjectionsCard", () => ({
  ProjectionsCard: () => <div>projections-card</div>,
}));

vi.mock("@chakra-ui/react", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    // The pages under test only use these as layout wrappers; rendering them
    // for real would drag the whole Chakra provider in for no added coverage.
    VStack: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    HStack: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Spacer: () => null,
    Button: ({ children }: { children: React.ReactNode }) => (
      <button type="button">{children}</button>
    ),
  };
});

afterEach(() => {
  cleanup();
  mockReplace.mockClear();
});

describe("ops surface consolidation", () => {
  describe("given schedules and process wakes are due", () => {
    describe("when the operator opens the schedules page", () => {
      /** @scenario Upcoming timed work sits with the schedules it previews */
      it("lists the soonest-due work above the calendar", () => {
        render(<OpsSchedulesPage />);

        expect(screen.getByText("upcoming-work-card")).toBeTruthy();
        expect(screen.getByText("scheduler-content")).toBeTruthy();
      });
    });
  });

  describe("given a projection replay has run", () => {
    describe("when the operator opens the projections page", () => {
      /** @scenario Replay history sits with the projections it replays */
      it("reports the most recent replay beside the projections", () => {
        render(<OpsProjectionsPage />);

        expect(screen.getByText("replay-history-section")).toBeTruthy();
        expect(screen.getByText("projections-card")).toBeTruthy();
      });
    });
  });
});

/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { OpsHostProvider } from "../../../../model/ops-host.ts";
import { fakeOpsHost } from "../../../../testing.tsx";
import OpsProjectionsPage from "../ops-projections.screen.tsx";
import OpsSchedulesPage from "../ops-schedules.screen.tsx";

/** Placement guards: cards on the page whose question they answer. */

vi.mock("../../../../ui/sections/event-sourcing-layout.tsx", () => ({
  EventSourcingLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("../../../../features/event-store/ui/sections/upcoming-work-panel.tsx", () => ({
  UpcomingWorkCard: () => <div>upcoming-work-card</div>,
}));
vi.mock("../../../../features/event-store/ui/sections/scheduler-panel.tsx", () => ({
  SchedulerContent: () => <div>scheduler-content</div>,
}));
vi.mock("../../../../features/event-store/ui/sections/replay-history-panel.tsx", () => ({
  ReplayHistorySection: () => <div>replay-history-section</div>,
}));
vi.mock("../../../../features/event-store/ui/sections/projections-panel.tsx", () => ({
  ProjectionsCard: () => <div>projections-card</div>,
}));
vi.mock("../../../../features/event-store/ui/sections/ops-replay-drawer.tsx", () => ({
  OpsReplayDrawer: () => <div>ops-replay-drawer</div>,
}));

/**
 * The screens read their overlay key off the host, so they are mounted inside
 * one — the same host their frontend feature supplies. The Chakra primitives
 * are still faked below, which is why the provider itself is not needed.
 */
const withHost = (element: React.ReactElement, host = fakeOpsHost()) => ({
  ...render(<OpsHostProvider value={host}>{element}</OpsHostProvider>),
  host,
});

vi.mock("@chakra-ui/react", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    // The pages under test only use these as layout wrappers; rendering them
    // for real would drag the whole Chakra provider in for no added coverage.
    VStack: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    HStack: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Spacer: () => null,
    // `onClick` is passed through on purpose: the replay drawer's address is
    // written by this button, and a fake that swallowed the handler would make
    // the address scenario below pass without anything happening.
    Button: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
      <button type="button" onClick={onClick}>
        {children}
      </button>
    ),
  };
});

describe("ops surface consolidation", () => {
  describe("given schedules and process wakes are due", () => {
    describe("when the operator opens the schedules page", () => {
      /** @scenario Upcoming timed work sits with the schedules it previews */
      it("lists the soonest-due work above the calendar", () => {
        withHost(<OpsSchedulesPage />);

        expect(screen.getByText("upcoming-work-card")).toBeTruthy();
        expect(screen.getByText("scheduler-content")).toBeTruthy();
      });
    });
  });

  describe("given a projection replay has run", () => {
    describe("when the operator opens the projections page", () => {
      /** @scenario Replay history sits with the projections it replays */
      it("reports the most recent replay beside the projections", () => {
        withHost(<OpsProjectionsPage />);

        expect(screen.getByText("replay-history-section")).toBeTruthy();
        expect(screen.getByText("projections-card")).toBeTruthy();
      });
    });
  });

  /**
   * The replay wizard uses its own query key rather than the application
   * drawer registry, which this package may not carry a copy of. What must
   * survive: sending the URL lets an on-call operator open the same replay.
   */
  describe("given an operator on the projections page", () => {
    describe("when they start a replay", () => {
      /** @scenario "A started replay is in the address, not only on the screen" */
      it("puts the wizard in the address rather than in a registry", () => {
        const { host } = withHost(<OpsProjectionsPage />);

        fireEvent.click(screen.getByText("Replay projections"));

        expect(host.recording.queries.at(-1)?.next).toEqual({ replay: "open" });
      });

      /** @scenario "The replay address opens the wizard for whoever follows it" */
      it("opens the wizard for a reader who arrives on that address", () => {
        withHost(<OpsProjectionsPage />, fakeOpsHost({ query: { replay: "open" } }));

        expect(screen.getByText("ops-replay-drawer")).toBeTruthy();
      });

      it("leaves it shut for a reader who arrives without it", () => {
        withHost(<OpsProjectionsPage />);

        expect(screen.queryByText("ops-replay-drawer")).toBeNull();
      });
    });
  });
});

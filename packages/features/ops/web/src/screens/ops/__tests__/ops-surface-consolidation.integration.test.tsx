/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { fakeOpsHost } from "../../../testing";
import { OpsHostProvider } from "../../../model/ops-host";
import OpsProjectionsPage from "../ops-projections.screen";
import OpsSchedulesPage from "../ops-schedules.screen";

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

vi.mock("../../../ui/sections/event-sourcing-layout", () => ({
  EventSourcingLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("../../../features/event-store/ui/sections/upcoming-work-panel", () => ({
  UpcomingWorkCard: () => <div>upcoming-work-card</div>,
}));
vi.mock("../../../features/event-store/ui/sections/scheduler-panel", () => ({
  SchedulerContent: () => <div>scheduler-content</div>,
}));
vi.mock("../../../features/event-store/ui/sections/replay-history-panel", () => ({
  ReplayHistorySection: () => <div>replay-history-section</div>,
}));
vi.mock("../../../features/event-store/ui/sections/projections-panel", () => ({
  ProjectionsCard: () => <div>projections-card</div>,
}));
vi.mock("../../../features/event-store/ui/sections/ops-replay-drawer", () => ({
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
   * The replay wizard used to be `openDrawer("opsReplay")` — a name in the
   * application drawer registry, which is a composition this package may not
   * carry a copy of. It keeps its own query key instead, and the property that
   * has to survive is the one the registry was actually giving it: an operator
   * mid-replay can send the URL to whoever is on call with them and they open
   * the same thing.
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

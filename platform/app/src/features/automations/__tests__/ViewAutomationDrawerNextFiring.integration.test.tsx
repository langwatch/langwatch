/**
 * @vitest-environment jsdom
 *
 * The in-depth view's "what happens next": schedules, digest windows, paused
 * states, and the alert sweep cadence. Binds
 * specs/automations/evaluation-visibility.feature. Sibling suites:
 * ViewAutomationDrawerHistory (what already happened) and
 * ViewAutomationDrawerRunNow (running the conditions against live traces).
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ViewAutomationDrawer } from "../ViewAutomationDrawer";
import {
  fakeQuery,
  GRAPH_ALERT_ROW,
  TRACE_AUTOMATION_ROW,
} from "./viewDrawerTestKit";

const MINUTE_MS = 60 * 1000;

let mockTriggerRow: Record<string, unknown> | null = null;
let mockNextFiring: Record<string, unknown> | null = null;

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    openDrawer: vi.fn(),
    closeDrawer: vi.fn(),
    drawerOpen: vi.fn(() => false),
    canGoBack: false,
    goBack: vi.fn(),
  }),
  useDrawerParams: () => ({}),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-1", name: "Proj", slug: "proj" },
    organization: { id: "org-1" },
    team: { slug: "team-1" },
  }),
}));

vi.mock("~/components/automations/FilterDisplay", () => ({
  FilterDisplay: ({ filters }: { filters: string }) => (
    <div data-testid="filter-display">{filters}</div>
  ),
}));

// Wiring only — the query semantics live in the kit's `fakeQuery`.
vi.mock("~/utils/api", () => ({
  api: {
    automation: {
      getTriggerById: {
        useQuery: (_input: unknown, options?: { enabled?: boolean }) =>
          fakeQuery(mockTriggerRow, options),
      },
      getFireHistory: {
        useInfiniteQuery: (
          _input: unknown,
          options?: { enabled?: boolean },
        ) => ({
          ...fakeQuery({ pages: [{ fires: [], nextCursor: null }] }, options),
          hasNextPage: false,
          isFetchingNextPage: false,
          fetchNextPage: vi.fn(),
        }),
      },
      getLatestEvaluation: {
        useQuery: (_input: unknown, options?: { enabled?: boolean }) =>
          fakeQuery(null, options),
      },
      getNextFiring: {
        useQuery: (_input: unknown, options?: { enabled?: boolean }) =>
          fakeQuery(mockNextFiring, options),
      },
      getWebhookDeliveries: {
        useQuery: (_input: unknown, options?: { enabled?: boolean }) =>
          fakeQuery([], options),
      },
    },
    graphs: {
      getById: {
        useQuery: (_input: unknown, options?: { enabled?: boolean }) =>
          fakeQuery(null, options),
      },
    },
    dataset: {
      getAll: {
        useQuery: (_input: unknown, options?: { enabled?: boolean }) =>
          fakeQuery([], options),
      },
    },
    tracesV2: {
      list: {
        useQuery: (_input: unknown, options?: { enabled?: boolean }) =>
          fakeQuery(undefined, options),
      },
    },
  },
}));

function renderDrawer() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <ViewAutomationDrawer automationId="trigger_1" />
    </ChakraProvider>,
  );
}

describe("ViewAutomationDrawer next firing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTriggerRow = null;
    mockNextFiring = { kind: "alert", sweepIntervalMs: 30_000 };
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  describe("given a schedule with an active calendar entry", () => {
    describe("when the drawer renders", () => {
      /** @scenario The view shows the next scheduled firing */
      it("shows the next time it sends", () => {
        // Pinned clock: the relative-time wording must not depend on when —
        // or in which timezone — the suite happens to run.
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-06-01T12:00:00.000Z"));
        mockTriggerRow = {
          ...TRACE_AUTOMATION_ROW,
          triggerKind: "REPORT",
          filterQuery: null,
        };
        const nextRunAt = new Date(Date.now() + 90 * MINUTE_MS);
        mockNextFiring = {
          kind: "schedule",
          nextRunAt,
          paused: false,
        };

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
        mockTriggerRow = {
          ...TRACE_AUTOMATION_ROW,
          triggerKind: "REPORT",
          filterQuery: null,
          active: false,
        };
        mockNextFiring = {
          kind: "paused",
          subject: "schedule",
          pausedReason: null,
        };

        renderDrawer();

        expect(
          screen.getByText("Nothing, while this report is paused"),
        ).toBeDefined();
        expect(screen.getByText(/Resume it/)).toBeDefined();
        // The state that explains the silence belongs with the identity too,
        // not only in the answer further down the drawer.
        expect(screen.getByText("Paused")).toBeDefined();
      });
    });
  });

  describe("given a paused graph-watching automation", () => {
    describe("when the drawer renders", () => {
      it("does not claim it is still being checked", () => {
        mockTriggerRow = { ...GRAPH_ALERT_ROW, active: false };
        mockNextFiring = {
          kind: "paused",
          subject: "alert",
          pausedReason: null,
        };

        renderDrawer();

        expect(
          screen.getByText("Nothing, while this automation is paused"),
        ).toBeDefined();
        expect(screen.queryByText("Checked as data arrives")).toBeNull();
      });
    });
  });

  describe("given an automation the platform paused for runaway volume", () => {
    describe("when the drawer renders", () => {
      it("explains what it did and what to change", () => {
        mockTriggerRow = { ...TRACE_AUTOMATION_ROW, active: false };
        mockNextFiring = {
          kind: "paused",
          subject: "automation",
          pausedReason: "runaway_volume",
        };

        renderDrawer();

        expect(
          screen.getByText("Nothing, while this automation is paused"),
        ).toBeDefined();
        expect(
          screen.getByText(/matched almost every trace in the project/),
        ).toBeDefined();
      });
    });
  });

  describe("given an automation that batches its notifications", () => {
    describe("when the drawer renders", () => {
      /** @scenario A digest automation shows when its next window closes */
      it("says when the next batch is sent", () => {
        // Same pinned clock as the schedule test: relative wording only.
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-06-01T12:00:00.000Z"));
        mockTriggerRow = TRACE_AUTOMATION_ROW;
        mockNextFiring = {
          kind: "digest",
          cadence: "5min_digest",
          windowClosesAt: new Date(Date.now() + 3 * MINUTE_MS),
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
        mockTriggerRow = GRAPH_ALERT_ROW;
        mockNextFiring = { kind: "alert", sweepIntervalMs: 30_000 };

        renderDrawer();

        expect(screen.getByText("Checked as data arrives")).toBeDefined();
        expect(screen.getByText(/every 30 seconds/)).toBeDefined();
      });
    });
  });
});

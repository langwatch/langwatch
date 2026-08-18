/**
 * @vitest-environment jsdom
 *
 * The in-depth view's history: what an alert's last check concluded, and how
 * repeated fires read. Binds specs/automations/evaluation-visibility.feature.
 * Sibling suites: ViewAutomationDrawerNextFiring (what happens next) and
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
let mockFires: Array<Record<string, unknown>> = [];
let mockLatestEvaluation: Record<string, unknown> | null = null;
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
          ...fakeQuery(
            { pages: [{ fires: mockFires, nextCursor: null }] },
            options,
          ),
          hasNextPage: false,
          isFetchingNextPage: false,
          fetchNextPage: vi.fn(),
        }),
      },
      getLatestEvaluation: {
        useQuery: (_input: unknown, options?: { enabled?: boolean }) =>
          fakeQuery(mockLatestEvaluation, options),
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

describe("ViewAutomationDrawer history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Pinned clock: every test here builds relative instants from now and
    // asserts relative wording, which must not ride the real wall clock.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-06-01T12:00:00.000Z"));
    mockTriggerRow = null;
    mockFires = [];
    mockLatestEvaluation = null;
    mockNextFiring = { kind: "alert", sweepIntervalMs: 30_000 };
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  describe("given an alert whose last check did not cross its threshold", () => {
    beforeEach(() => {
      mockTriggerRow = GRAPH_ALERT_ROW;
      mockLatestEvaluation = {
        evaluatedAt: new Date(Date.now() - 5 * MINUTE_MS),
        verdict: "not_breached",
        observedValue: 42,
        threshold: 100,
        operator: "gt",
        timePeriodMinutes: 60,
        skipCode: null,
      };
    });

    describe("when the drawer renders", () => {
      /** @scenario The view shows the last evaluation with observed value vs threshold */
      it("says when it was checked, what it observed, and that it did not fire", () => {
        renderDrawer();

        expect(screen.getByText(/The automation did not fire/)).toBeDefined();
        expect(screen.getByText(/5 minutes ago/)).toBeDefined();
        expect(
          screen.getByText(
            "observed 42, fires when greater than 100 over 1 hour",
          ),
        ).toBeDefined();
      });
    });
  });

  describe("given an alert whose last check crossed its threshold", () => {
    describe("when the drawer renders", () => {
      /** @scenario An automation that crossed its threshold reads as fired */
      it("says the automation fired on that check", () => {
        mockTriggerRow = GRAPH_ALERT_ROW;
        mockLatestEvaluation = {
          evaluatedAt: new Date(Date.now() - MINUTE_MS),
          verdict: "fired",
          observedValue: 250,
          threshold: 100,
          operator: "gt",
          timePeriodMinutes: 60,
          skipCode: null,
        };

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
        mockTriggerRow = GRAPH_ALERT_ROW;
        mockLatestEvaluation = {
          evaluatedAt: new Date(Date.now() - 2 * MINUTE_MS),
          verdict: "skipped",
          observedValue: null,
          threshold: 100,
          operator: "gt",
          timePeriodMinutes: 60,
          skipCode: "result_too_large",
        };

        renderDrawer();

        expect(screen.getByText(/The check was skipped/)).toBeDefined();
        expect(
          screen.getByText(/groups by a field with too many distinct values/),
        ).toBeDefined();
      });
    });
  });

  describe("given an alert that has never been evaluated", () => {
    describe("when the drawer renders", () => {
      /** @scenario An automation that has never been evaluated says so */
      it("says it has not been checked yet", () => {
        mockTriggerRow = GRAPH_ALERT_ROW;
        mockLatestEvaluation = null;
        mockFires = [];

        renderDrawer();

        expect(
          screen.getByText(/has not been checked yet either/),
        ).toBeDefined();
      });
    });
  });

  describe("given a trace automation that has fired repeatedly", () => {
    describe("when the drawer renders", () => {
      it("collapses a run of same-minute fires into one counted row", () => {
        mockTriggerRow = TRACE_AUTOMATION_ROW;
        const firedAt = Date.now() - 6 * MINUTE_MS;
        mockFires = Array.from({ length: 3 }, (_, index) => ({
          id: `sent_${index}`,
          triggerId: "trigger_1",
          customGraphId: null,
          createdAt: new Date(firedAt),
          resolvedAt: null,
        }));

        renderDrawer();

        expect(screen.getByText("Fired 3 times")).toBeDefined();
        expect(screen.getByText(/6 minutes ago/)).toBeDefined();
        // The whole history must render for a non-alert automation: it asks
        // for no evaluation, and a disabled query reports `isLoading` forever.
        expect(screen.queryByText(/has not fired yet/)).toBeNull();
      });
    });
  });
});

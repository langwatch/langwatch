/**
 * @vitest-environment jsdom
 *
 * The in-depth view's "run the conditions now": listing the traces that match
 * an automation's conditions today. Binds
 * specs/automations/evaluation-visibility.feature. Sibling suites:
 * ViewAutomationDrawerHistory and ViewAutomationDrawerNextFiring.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ViewAutomationDrawer } from "../ViewAutomationDrawer";
import {
  fakeQuery,
  GRAPH_ALERT_ROW,
  TRACE_AUTOMATION_ROW,
} from "./viewDrawerTestKit";

const MINUTE_MS = 60 * 1000;

let mockTriggerRow: Record<string, unknown> | null = null;
let mockMatchingTraces: Record<string, unknown> | undefined;

const { mockTracesRefetch } = vi.hoisted(() => ({
  mockTracesRefetch: vi.fn(),
}));

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
          fakeQuery({ kind: "alert", sweepIntervalMs: 30_000 }, options),
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
        useQuery: (_input: unknown, options?: { enabled?: boolean }) => ({
          ...fakeQuery(mockMatchingTraces, options),
          refetch: mockTracesRefetch,
        }),
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

describe("ViewAutomationDrawer run-now", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTriggerRow = null;
    mockMatchingTraces = undefined;
  });

  afterEach(() => {
    cleanup();
  });

  describe("given a trace automation with a search query", () => {
    describe("when the user runs the conditions against recent traces", () => {
      /** @scenario Run now lists currently matching traces */
      it("lists the matching traces with their input and output", async () => {
        mockTriggerRow = TRACE_AUTOMATION_ROW;
        mockMatchingTraces = {
          totalHits: 3,
          items: [
            {
              traceId: "trace_1",
              name: "checkout agent",
              timestamp: Date.now() - MINUTE_MS,
              durationMs: 1234,
              status: "error",
              input: "book me a flight",
              output: "upstream timed out",
            },
          ],
        };

        renderDrawer();
        await userEvent.click(
          screen.getByRole("button", { name: "Run the conditions now" }),
        );

        expect(
          screen.getByText("3 traces matched in the last 7 days"),
        ).toBeDefined();
        expect(screen.getByText("checkout agent")).toBeDefined();
        // Enough identity to find the trace again: its id and duration.
        expect(screen.getByText("trace_1")).toBeDefined();
        expect(screen.getByText(/1\.2s/)).toBeDefined();
        expect(screen.getByText(/book me a flight/)).toBeDefined();
        expect(screen.getByText(/upstream timed out/)).toBeDefined();
      });

      /** @scenario A never-matched automation explains itself */
      it("explains that nothing matched and why it stays quiet", async () => {
        mockTriggerRow = TRACE_AUTOMATION_ROW;
        mockMatchingTraces = { totalHits: 0, items: [] };

        renderDrawer();
        await userEvent.click(
          screen.getByRole("button", { name: "Run the conditions now" }),
        );

        expect(
          screen.getByText(/Nothing matched in the last 7 days/),
        ).toBeDefined();
        expect(
          screen.getByText(/so it stays quiet until one does/),
        ).toBeDefined();
      });
    });
  });

  describe("given an alert that watches a graph metric", () => {
    describe("when the drawer renders", () => {
      /** @scenario A graph-watching automation offers no trace run */
      it("offers no run-against-traces control", () => {
        mockTriggerRow = GRAPH_ALERT_ROW;

        renderDrawer();

        expect(
          screen.queryByRole("button", { name: "Run the conditions now" }),
        ).toBeNull();
      });
    });
  });
});

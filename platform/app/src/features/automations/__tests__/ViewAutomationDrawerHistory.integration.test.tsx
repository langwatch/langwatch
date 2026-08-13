/**
 * @vitest-environment jsdom
 *
 * The in-depth view: what the automation has done (its firing history and the
 * last check of an alert) and what it will do next. Binds
 * specs/automations/evaluation-visibility.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ViewAutomationDrawer } from "../ViewAutomationDrawer";

const MINUTE_MS = 60 * 1000;

let mockTriggerRow: Record<string, unknown> | null = null;
let mockFires: Array<Record<string, unknown>> = [];
let mockLatestEvaluation: Record<string, unknown> | null = null;
let mockNextFiring: Record<string, unknown> | null = null;
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

/**
 * A faithful-enough stand-in for one react-query v4 hook result.
 *
 * `enabled: false` is the case that matters: such a query never resolves, so
 * it reports `isLoading` FOREVER. A mock that hard-codes `isLoading: false`
 * makes that state unrepresentable — which is how a permanent skeleton over
 * every non-alert automation's history shipped once already.
 *
 * `undefined` means "has not resolved"; `null` means "resolved, and the
 * answer is nothing" (an automation that was never evaluated), which is a
 * settled query with `data === null`.
 */
const { fakeQuery } = vi.hoisted(() => ({
  fakeQuery: (data: unknown, options?: { enabled?: boolean }) => {
    const enabled = options?.enabled ?? true;
    const settled = enabled && data !== undefined;
    return {
      data,
      isLoading: !settled,
      isFetching: enabled && !settled,
      error: null,
      refetch: vi.fn(),
    };
  },
}));

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

const graphAlert = {
  id: "trigger_1",
  name: "p95 latency alert",
  action: "SEND_SLACK_MESSAGE",
  customGraphId: "graph_1",
  filters: "{}",
  triggerKind: "ALERT",
  actionParams: {
    slackWebhook: "https://hooks.slack.com/services/abc",
    seriesName: "0/latency/p95",
    operator: "gt",
    threshold: 100,
    timePeriod: 60,
  },
};

const traceAutomation = {
  id: "trigger_1",
  name: "Errors to Slack",
  action: "SEND_SLACK_MESSAGE",
  customGraphId: null,
  filters: "{}",
  filterQuery: "status:error",
  triggerKind: "AUTOMATION",
  actionParams: { slackWebhook: "https://hooks.slack.com/services/abc" },
};

describe("ViewAutomationDrawer in-depth view", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTriggerRow = null;
    mockFires = [];
    mockLatestEvaluation = null;
    mockNextFiring = { kind: "alert", sweepIntervalMs: 30_000 };
    mockMatchingTraces = undefined;
  });

  afterEach(() => {
    cleanup();
  });

  describe("given an alert whose last check did not cross its threshold", () => {
    beforeEach(() => {
      mockTriggerRow = graphAlert;
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
        mockTriggerRow = graphAlert;
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
        mockTriggerRow = graphAlert;
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
        mockTriggerRow = graphAlert;
        mockLatestEvaluation = null;
        mockFires = [];

        renderDrawer();

        expect(
          screen.getByText(/has not been checked yet either/),
        ).toBeDefined();
      });
    });
  });

  describe("given a schedule with an active calendar entry", () => {
    describe("when the drawer renders", () => {
      /** @scenario The view shows the next scheduled firing */
      it("shows the next time it sends", () => {
        mockTriggerRow = {
          ...traceAutomation,
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
          ...traceAutomation,
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
        mockTriggerRow = { ...graphAlert, active: false };
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
        mockTriggerRow = { ...traceAutomation, active: false };
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

  describe("given a trace automation that has fired repeatedly", () => {
    describe("when the drawer renders", () => {
      it("collapses a run of same-minute fires into one counted row", () => {
        mockTriggerRow = traceAutomation;
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

  describe("given an automation that batches its notifications", () => {
    describe("when the drawer renders", () => {
      /** @scenario A digest automation shows when its next window closes */
      it("says when the next batch is sent", () => {
        mockTriggerRow = traceAutomation;
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
        mockTriggerRow = graphAlert;
        mockNextFiring = { kind: "alert", sweepIntervalMs: 30_000 };

        renderDrawer();

        expect(screen.getByText("Checked as data arrives")).toBeDefined();
        expect(screen.getByText(/every 30 seconds/)).toBeDefined();
      });
    });
  });

  describe("given a trace automation with a search query", () => {
    describe("when the user runs the conditions against recent traces", () => {
      /** @scenario Run now lists currently matching traces */
      it("lists the matching traces with their input and output", async () => {
        mockTriggerRow = traceAutomation;
        mockMatchingTraces = {
          totalHits: 3,
          items: [
            {
              traceId: "trace_1",
              name: "checkout agent",
              timestamp: Date.now() - MINUTE_MS,
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
        expect(screen.getByText(/book me a flight/)).toBeDefined();
        expect(screen.getByText(/upstream timed out/)).toBeDefined();
      });

      /** @scenario A never-matched automation explains itself */
      it("explains that nothing matched and why it stays quiet", async () => {
        mockTriggerRow = traceAutomation;
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
        mockTriggerRow = graphAlert;

        renderDrawer();

        expect(
          screen.queryByRole("button", { name: "Run the conditions now" }),
        ).toBeNull();
      });
    });
  });
});

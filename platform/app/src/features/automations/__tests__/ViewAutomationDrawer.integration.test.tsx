/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ViewAutomationDrawer } from "../ViewAutomationDrawer";

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

let mockTriggerRow: Record<string, unknown> | null = null;
let mockRecentFires: Array<Record<string, unknown>> = [];
const mockGraphRow: Record<string, unknown> | null = null;
const mockDatasets: Array<Record<string, unknown>> = [];
let mockWebhookDeliveries: Array<Record<string, unknown>> = [];
let mockLatestEvaluation: Record<string, unknown> | null = null;
let mockNextFiring: Record<string, unknown> | null = null;
let mockMatchingTraces: Record<string, unknown> | undefined;
let mockHasNextFirePage = false;
const mockFetchNextFirePage = vi.fn();

const { mockOpenDrawer, mockCloseDrawer } = vi.hoisted(() => ({
  mockOpenDrawer: vi.fn(),
  mockCloseDrawer: vi.fn(),
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    openDrawer: mockOpenDrawer,
    closeDrawer: mockCloseDrawer,
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

vi.mock("~/utils/api", () => ({
  api: {
    automation: {
      getTriggerById: {
        useQuery: () => ({
          data: mockTriggerRow,
          isLoading: false,
          error: null,
        }),
      },
      getFireHistory: {
        useInfiniteQuery: () => ({
          data: { pages: [{ fires: mockRecentFires, nextCursor: null }] },
          isLoading: false,
          hasNextPage: mockHasNextFirePage,
          isFetchingNextPage: false,
          fetchNextPage: mockFetchNextFirePage,
          error: null,
        }),
      },
      getLatestEvaluation: {
        useQuery: () => ({
          data: mockLatestEvaluation,
          isLoading: false,
          error: null,
        }),
      },
      getNextFiring: {
        useQuery: () => ({
          data: mockNextFiring,
          isLoading: false,
          error: null,
        }),
      },
      getWebhookDeliveries: {
        useQuery: () => ({
          data: mockWebhookDeliveries,
          isLoading: false,
          error: null,
        }),
      },
    },
    graphs: {
      getById: {
        useQuery: () => ({
          data: mockGraphRow,
          isLoading: false,
          error: null,
        }),
      },
    },
    dataset: {
      getAll: {
        useQuery: () => ({
          data: mockDatasets,
          isLoading: false,
          error: null,
        }),
      },
    },
    tracesV2: {
      list: {
        useQuery: () => ({
          data: mockMatchingTraces,
          isFetching: false,
          error: null,
          refetch: vi.fn(),
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

describe("ViewAutomationDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWebhookDeliveries = [];
    mockLatestEvaluation = null;
    mockNextFiring = { kind: "immediate", traceDebounceMs: 30_000 };
    mockMatchingTraces = undefined;
    mockHasNextFirePage = false;
  });

  afterEach(() => {
    cleanup();
  });

  describe("given a graph alert with fire history", () => {
    beforeEach(() => {
      mockTriggerRow = {
        id: "trigger_1",
        name: "p95 latency alert",
        action: "SEND_SLACK_MESSAGE",
        customGraphId: "graph_1",
        filters: "{}",
        actionParams: {
          slackWebhook: "https://hooks.slack.com/services/abc",
          seriesName: "0/latency/p95",
          operator: "gt",
          threshold: 250,
          timePeriod: 60,
        },
      };
      const firedAt = new Date(Date.now() - 2 * HOUR_MS);
      mockRecentFires = [
        {
          id: "sent_open",
          triggerId: "trigger_1",
          customGraphId: "graph_1",
          createdAt: firedAt,
          resolvedAt: null,
        },
        {
          id: "sent_resolved",
          triggerId: "trigger_1",
          customGraphId: "graph_1",
          createdAt: new Date(Date.now() - 5 * HOUR_MS),
          resolvedAt: new Date(Date.now() - 5 * HOUR_MS + 15 * MINUTE_MS),
        },
      ];
    });

    describe("when the drawer renders", () => {
      it("shows the automation identity and kind badge", () => {
        renderDrawer();

        expect(screen.getByText("p95 latency alert")).toBeDefined();
        expect(screen.getByText("Alert")).toBeDefined();
      });

      it("lists recent fires with resolution durations", () => {
        renderDrawer();

        // A resolved incident shows when it fired and how long it lasted.
        expect(
          screen.getByText(/about 5 hours ago · lasted 15m/),
        ).toBeDefined();
      });

      it("marks the open incident as still firing", () => {
        renderDrawer();

        expect(screen.getByText("Firing")).toBeDefined();
        expect(screen.getByText("still firing")).toBeDefined();
      });
    });

    describe("when the user clicks Edit", () => {
      it("opens the edit drawer for the same automation", async () => {
        renderDrawer();

        await userEvent.click(screen.getByRole("button", { name: "Edit" }));

        expect(mockOpenDrawer).toHaveBeenCalledWith("automation", {
          automationId: "trigger_1",
        });
      });
    });
  });

  describe("given a saved webhook automation", () => {
    it("shows the method, safe hostname, and empty delivery state", () => {
      mockTriggerRow = {
        id: "trigger_1",
        name: "Pager webhook",
        action: "SEND_WEBHOOK",
        customGraphId: null,
        filters: "{}",
        actionParams: {
          url: "https://events.example.test/private/path?token=hidden",
          method: "PATCH",
          headers: { Authorization: "__kept__" },
        },
      };

      renderDrawer();

      expect(screen.getByText("PATCH events.example.test")).toBeDefined();
      expect(
        screen.getByText("No delivery attempts recorded yet."),
      ).toBeDefined();
      expect(screen.queryByText(/token=hidden/)).toBeNull();
    });
  });

  describe("given a webhook automation with a failed delivery attempt", () => {
    beforeEach(() => {
      mockTriggerRow = {
        id: "trigger_1",
        name: "Pager webhook",
        action: "SEND_WEBHOOK",
        customGraphId: null,
        filters: "{}",
        actionParams: {
          url: "https://events.example.test/hook",
          method: "POST",
          headers: {},
        },
      };
      mockRecentFires = [];
      mockWebhookDeliveries = [
        {
          id: "delivery_1",
          triggerId: "trigger_1",
          dispatchId: "dispatch_1",
          responseStatus: 500,
          latencyMs: 120,
          error: null,
          response: {
            body: "<script>alert('xss')</script>",
            headers: { "X-Debug": "<img src=x onerror=alert(1)>" },
          },
          outcome: "terminal",
          firedAt: new Date(Date.now() - HOUR_MS),
        },
      ];
    });

    describe("when the user expands the attempt", () => {
      it("renders the response body and headers as literal text, not markup", async () => {
        renderDrawer();

        await userEvent.click(screen.getByRole("button", { name: /HTTP 500/ }));

        expect(screen.getByText("<script>alert('xss')</script>")).toBeDefined();
        expect(document.querySelector("script")).toBeNull();
        expect(
          screen.getByText("X-Debug: <img src=x onerror=alert(1)>"),
        ).toBeDefined();
        expect(document.querySelector("img")).toBeNull();
      });
    });
  });

  describe("given a graph alert whose incident ran for over an hour", () => {
    beforeEach(() => {
      mockTriggerRow = {
        id: "trigger_1",
        name: "p95 latency alert",
        action: "SEND_SLACK_MESSAGE",
        customGraphId: "graph_1",
        filters: "{}",
        actionParams: {
          slackWebhook: "https://hooks.slack.com/services/abc",
          seriesName: "0/latency/p95",
          operator: "gt",
          threshold: 250,
          timePeriod: 60,
        },
      };
    });

    describe("when the incident resolved 1h 30m after firing", () => {
      it("formats the resolution duration in hours and minutes", () => {
        const firedAt = new Date(Date.now() - 3 * HOUR_MS);
        mockRecentFires = [
          {
            id: "sent_long",
            triggerId: "trigger_1",
            customGraphId: "graph_1",
            createdAt: firedAt,
            resolvedAt: new Date(firedAt.getTime() + HOUR_MS + 30 * MINUTE_MS),
          },
        ];

        renderDrawer();

        expect(screen.getByText(/lasted 1h 30m/)).toBeDefined();
      });
    });

    describe("when the incident resolved on an exact hour boundary", () => {
      it("omits the trailing minutes for a whole-hour duration", () => {
        const firedAt = new Date(Date.now() - 4 * HOUR_MS);
        mockRecentFires = [
          {
            id: "sent_exact",
            triggerId: "trigger_1",
            customGraphId: "graph_1",
            createdAt: firedAt,
            resolvedAt: new Date(firedAt.getTime() + 2 * HOUR_MS),
          },
        ];

        renderDrawer();

        expect(screen.getByText(/lasted 2h$/)).toBeDefined();
      });
    });
  });

  describe("given a bot-delivery Slack automation with a channel", () => {
    /** @scenario The automation view names its Slack destination */
    it("names the delivery method and shows the destination channel", () => {
      mockTriggerRow = {
        id: "trigger_1",
        name: "Errors to #ops",
        action: "SEND_SLACK_MESSAGE",
        customGraphId: null,
        filters: "{}",
        actionParams: {
          slackDelivery: "bot",
          slackChannelId: "C0123456",
          slackBotTokenSet: true,
        },
      };
      mockRecentFires = [];

      renderDrawer();

      // #6244: this used to read "Slack webhook" for every Slack
      // automation, including bot deliveries that never carry a webhook at
      // all.
      expect(screen.getByText("Slack app · channel C0123456")).toBeDefined();
      expect(screen.queryByText("Slack webhook")).toBeNull();
    });
  });

  describe("given a bot-delivery Slack automation with no channel chosen yet", () => {
    it("names the delivery method without inventing a channel", () => {
      mockTriggerRow = {
        id: "trigger_1",
        name: "Draft Slack app automation",
        action: "SEND_SLACK_MESSAGE",
        customGraphId: null,
        filters: "{}",
        actionParams: {
          slackDelivery: "bot",
          slackBotTokenSet: true,
        },
      };
      mockRecentFires = [];

      renderDrawer();

      expect(screen.getByText("Slack app")).toBeDefined();
      expect(screen.queryByText(/channel/)).toBeNull();
    });
  });

  describe("given a legacy Slack row saved before delivery method existed", () => {
    it("falls back to webhook delivery and shows the masked URL on hover", () => {
      mockTriggerRow = {
        id: "trigger_1",
        name: "Old-style Slack automation",
        action: "SEND_SLACK_MESSAGE",
        customGraphId: null,
        filters: "{}",
        // No `slackDelivery` key at all — the shape every row saved before
        // bot delivery existed actually has.
        actionParams: {
          slackWebhook: "https://hooks.slack.com/services/legacy",
        },
      };
      mockRecentFires = [];

      renderDrawer();

      expect(screen.getByText("Slack webhook")).toBeDefined();
      expect(screen.queryByText("Slack app")).toBeNull();
      // The masked label is a real tooltip trigger (the full URL shows on
      // hover) — a distinct code path from the redacted case below, which
      // renders no tooltip at all.
      expect(document.querySelector('[data-scope="tooltip"]')).not.toBeNull();
    });
  });

  describe("given a Slack webhook row read through a redacting boundary", () => {
    it("shows the masked label without rendering the placeholder as a URL", () => {
      mockTriggerRow = {
        id: "trigger_1",
        name: "Redacted webhook automation",
        action: "SEND_SLACK_MESSAGE",
        customGraphId: null,
        filters: "{}",
        actionParams: {
          slackDelivery: "webhook",
          // Not a real `https://hooks.slack.com/...` URL — stands in for
          // whatever a redacting boundary substitutes for the secret.
          slackWebhook: "[redacted]",
        },
      };
      mockRecentFires = [];

      renderDrawer();

      expect(screen.getByText("Slack webhook")).toBeDefined();
      // Never rendered as though `[redacted]` were a real, hoverable URL.
      expect(screen.queryByText("[redacted]")).toBeNull();
      expect(document.querySelector('[data-scope="tooltip"]')).toBeNull();
    });
  });

  describe("given a trace automation that never fired", () => {
    beforeEach(() => {
      mockTriggerRow = {
        id: "trigger_1",
        name: "Slow traces to Slack",
        action: "SEND_SLACK_MESSAGE",
        customGraphId: null,
        filters: JSON.stringify({ "spans.model": ["gpt-5-mini"] }),
        actionParams: {
          slackWebhook: "https://hooks.slack.com/services/abc",
        },
      };
      mockRecentFires = [];
    });

    describe("when the drawer renders", () => {
      it("shows the automation kind badge and an empty history state", () => {
        renderDrawer();

        expect(screen.getByText("Automation")).toBeDefined();
        expect(
          screen.getByText(/This automation has not fired yet\./),
        ).toBeDefined();
      });
    });
  });
});

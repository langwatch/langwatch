/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ViewAutomationDrawer } from "../ViewAutomationDrawer";
import { fakeQuery } from "./viewDrawerTestKit";

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

// The react-query stand-in contract lives once in the kit; the closures
// below read it at render time, after every import has initialized.
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
            { pages: [{ fires: mockRecentFires, nextCursor: null }] },
            options,
          ),
          hasNextPage: mockHasNextFirePage,
          isFetchingNextPage: false,
          fetchNextPage: mockFetchNextFirePage,
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
          fakeQuery(mockWebhookDeliveries, options),
      },
    },
    graphs: {
      getById: {
        useQuery: (_input: unknown, options?: { enabled?: boolean }) =>
          fakeQuery(mockGraphRow, options),
      },
    },
    dataset: {
      getAll: {
        useQuery: (_input: unknown, options?: { enabled?: boolean }) =>
          fakeQuery(mockDatasets, options),
      },
    },
    tracesV2: {
      list: {
        useQuery: (_input: unknown, options?: { enabled?: boolean }) =>
          fakeQuery(mockMatchingTraces, options),
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
        // One noun for both subjects, so the badge says what it watches
        // rather than naming a kind that no longer exists (ADR-093 §1).
        expect(screen.getByText("Watches a graph")).toBeDefined();
        expect(screen.queryByText("Alert")).toBeNull();
      });

      it("lists recent fires with resolution durations", () => {
        renderDrawer();

        // A resolved incident shows when it fired and how long it lasted.
        expect(
          screen.getByText(/about 5 hours ago · lasted 15 minutes/),
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
      /** @scenario "The recent deliveries list shows what the endpoint answered" */
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

        expect(screen.getByText(/lasted 1 hour 30 minutes/)).toBeDefined();
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

        expect(screen.getByText(/lasted 2 hours$/)).toBeDefined();
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
    it("falls back to webhook delivery and shows the masked URL on hover", async () => {
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
      // The full URL genuinely shows on hover — asserted by hovering and
      // reading the URL text, not by the shape of tooltip markup.
      await userEvent.hover(screen.getByText("Slack webhook"));
      expect(
        await screen.findByText(
          "https://hooks.slack.com/services/legacy",
          undefined,
          { timeout: 3000 },
        ),
      ).toBeDefined();
    });
  });

  describe("given a Slack webhook row read through a redacting boundary", () => {
    it("shows the masked label without rendering the placeholder as a URL", async () => {
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
      // Never rendered as though `[redacted]` were a real, hoverable URL —
      // hovering shows nothing, asserted on the text itself.
      await userEvent.hover(screen.getByText("Slack webhook"));
      await new Promise((resolve) => setTimeout(resolve, 600));
      expect(screen.queryByText("[redacted]")).toBeNull();
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
      it("shows what it watches and an empty history state", () => {
        renderDrawer();

        expect(screen.getByText("Watches a trace filter")).toBeDefined();
        expect(
          screen.getByText(/This automation has not fired yet\./),
        ).toBeDefined();
      });
    });
  });
});

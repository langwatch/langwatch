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
      getRecentFires: {
        useQuery: () => ({
          data: mockRecentFires,
          isLoading: false,
          error: null,
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

        expect(
          screen.getByText(/fired about 2 hours ago$/),
        ).toBeDefined();
        expect(
          screen.getByText(/resolved after 15m/),
        ).toBeDefined();
      });

      it("marks the open incident as still firing", () => {
        renderDrawer();

        expect(screen.getByText("Still firing")).toBeDefined();
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
      it("shows the automation kind badge and an empty fires state", () => {
        renderDrawer();

        expect(screen.getByText("Automation")).toBeDefined();
        expect(
          screen.getByText("This automation has not fired yet."),
        ).toBeDefined();
      });
    });
  });
});

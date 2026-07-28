/**
 * @vitest-environment jsdom
 *
 * The View drawer's Conditions section: a query-subject automation shows its
 * search query (ADR-043), legacy structured filters render via FilterDisplay,
 * and an automation with neither shows the "No conditions" empty state (the
 * stored `filters` string is "{}" for query automations, which is truthy, so
 * emptiness must be judged on the parsed object).
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ViewAutomationDrawer } from "../ViewAutomationDrawer";

let mockTriggerRow: Record<string, unknown> | null = null;

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
        useQuery: () => ({ data: [], isLoading: false, error: null }),
      },
      getWebhookDeliveries: {
        useQuery: () => ({ data: [], isLoading: false, error: null }),
      },
    },
    graphs: {
      getById: {
        useQuery: () => ({ data: null, isLoading: false, error: null }),
      },
    },
    dataset: {
      getAll: {
        useQuery: () => ({ data: [], isLoading: false, error: null }),
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

const baseTrigger = {
  id: "trigger_1",
  name: "Slow traces to Slack",
  action: "SEND_SLACK_MESSAGE",
  customGraphId: null,
  actionParams: {
    slackWebhook: "https://hooks.slack.com/services/abc",
  },
};

describe("ViewAutomationDrawer conditions section", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe("given a query-subject automation", () => {
    beforeEach(() => {
      mockTriggerRow = {
        ...baseTrigger,
        // The authoring path stores the query on `filterQuery` and leaves the
        // structured `filters` column as the empty-object string.
        filterQuery: "status:error model:gpt-5-mini",
        filters: "{}",
      };
    });

    describe("when the drawer renders", () => {
      it("shows the search query as the conditions", () => {
        renderDrawer();

        expect(
          screen.getByText("status:error model:gpt-5-mini"),
        ).toBeDefined();
        expect(screen.queryByTestId("filter-display")).toBeNull();
        expect(screen.queryByText("No conditions")).toBeNull();
      });
    });
  });

  describe("given a legacy automation with structured filters", () => {
    const filters = JSON.stringify({ "spans.model": ["gpt-5-mini"] });

    beforeEach(() => {
      mockTriggerRow = {
        ...baseTrigger,
        filterQuery: null,
        filters,
      };
    });

    describe("when the drawer renders", () => {
      it("shows the structured filters via FilterDisplay", () => {
        renderDrawer();

        expect(screen.getByTestId("filter-display").textContent).toBe(filters);
        expect(screen.queryByText("No conditions")).toBeNull();
      });
    });
  });

  describe("given an automation with no query and empty filters", () => {
    beforeEach(() => {
      mockTriggerRow = {
        ...baseTrigger,
        filterQuery: null,
        filters: "{}",
      };
    });

    describe("when the drawer renders", () => {
      it("shows the no-conditions empty state", () => {
        renderDrawer();

        expect(screen.getByText("No conditions")).toBeDefined();
        expect(screen.queryByTestId("filter-display")).toBeNull();
      });
    });
  });
});

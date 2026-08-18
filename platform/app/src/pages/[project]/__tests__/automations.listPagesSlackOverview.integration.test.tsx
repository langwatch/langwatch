/**
 * @vitest-environment jsdom
 *
 * specs/automations/list-pages.feature
 * specs/automations/source-merge.feature
 *
 * The Slack delivery cells and the Overview tab's create menu, split from
 * `automations.listPages.integration.test.tsx` so each suite stays under the
 * file-size ceiling. Same page, same fixture project (`listPages.fixture.ts`).
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { allTriggers } from "./listPages.fixture";

const { mockPathnameRef, mockOpenDrawer } = vi.hoisted(() => ({
  mockPathnameRef: { current: "/test-project/automations" },
  mockOpenDrawer: vi.fn(),
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    pathname: mockPathnameRef.current,
    query: { project: "test-project" },
    push: vi.fn(),
    isReady: true,
  }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1", slug: "test-project", name: "Test Project" },
    organization: { id: "org-1" },
    team: { slug: "team-1" },
    hasPermission: () => true,
  }),
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    openDrawer: mockOpenDrawer,
    closeDrawer: vi.fn(),
    drawerOpen: () => false,
    canGoBack: false,
    goBack: vi.fn(),
  }),
}));

vi.mock("~/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("~/components/WithPermissionGuard", () => ({
  withPermissionGuard: () => (component: unknown) => component,
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

vi.mock("~/utils/api", () => ({
  api: {
    automation: {
      getTriggers: {
        useQuery: () => ({
          data: allTriggers,
          isLoading: false,
          refetch: vi.fn(),
        }),
      },
      getTriggerStats: { useQuery: () => ({ data: [] }) },
      getDailyCapStatus: { useQuery: () => ({ data: { counts: {}, cap: 0 } }) },
      getReportSchedules: { useQuery: () => ({ data: [], isLoading: false }) },
      getRecentActivity: { useQuery: () => ({ data: [], isLoading: false }) },
      toggleTrigger: {
        useMutation: () => ({ mutate: vi.fn(), isLoading: false }),
      },
      deleteById: {
        useMutation: () => ({ mutate: vi.fn(), isLoading: false }),
      },
    },
    dataset: {
      getAll: { useQuery: () => ({ data: [], isLoading: false }) },
    },
    graphs: {
      getAll: { useQuery: () => ({ data: [], isLoading: false }) },
    },
    slackIntegration: {
      getStatus: {
        useQuery: () => ({ data: { connected: false }, isLoading: false }),
      },
    },
    useUtils: () => ({
      automation: {
        getTriggerById: { invalidate: vi.fn() },
      },
    }),
  },
}));

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const renderPage = async () => {
  const AutomationsPage = (await import("../automations")).default;
  return render(<AutomationsPage />, { wrapper: Wrapper });
};

describe("given a Slack automation on the unified table", () => {
  beforeEach(() => {
    mockPathnameRef.current = "/test-project/automations/automations";
  });

  afterEach(() => {
    cleanup();
  });

  describe("when a row is a bot-delivery Slack automation", () => {
    /** @scenario The delivery cell names a bot-delivery Slack automation */
    it("names the Slack app and its destination channel, not 'Webhook'", async () => {
      await renderPage();

      // #6244: this cell used to show "Webhook" with an empty tooltip for
      // every Slack row, including bot deliveries that never carry a
      // webhook at all.
      const cell = screen.getByText("Slack app · channel C0999999");
      expect(cell).toBeInTheDocument();
      // Scoped to this row: the fixture is shared with the other list-page
      // suite, so a document-wide query would start failing the day it gains
      // a plain webhook automation — for a reason unrelated to this cell.
      const row = cell.closest("tr");
      expect(row).not.toBeNull();
      expect(within(row!).queryByText("Webhook")).toBeNull();
    });
  });

  describe("when a row is a legacy webhook-delivery Slack automation", () => {
    it("keeps the existing webhook presentation", async () => {
      await renderPage();

      expect(screen.getByText("Slack webhook")).toBeInTheDocument();
    });
  });
});

describe("given the Overview tab", () => {
  beforeEach(() => {
    mockPathnameRef.current = "/test-project/automations";
    mockOpenDrawer.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  describe("when the user opens the create menu", () => {
    /** @scenario "The Overview offers creating an automation or a report" */
    it("offers an automation and a report, and no longer an alert", async () => {
      const user = userEvent.setup();
      await renderPage();

      await user.click(screen.getByRole("button", { name: /Create/ }));

      expect(
        screen.getByRole("menuitem", { name: "New automation" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("menuitem", { name: "New report" }),
      ).toBeInTheDocument();
      // What an automation watches is chosen in its own first step now, so
      // there is nothing left for a third menu item to pre-set (ADR-093 §1).
      expect(
        screen.queryByRole("menuitem", { name: "New alert" }),
      ).not.toBeInTheDocument();

      await user.click(
        screen.getByRole("menuitem", { name: "New automation" }),
      );
      expect(mockOpenDrawer).toHaveBeenCalledWith("automation", {});
    });
  });
});

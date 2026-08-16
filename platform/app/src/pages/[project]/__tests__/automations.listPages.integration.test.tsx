/**
 * @vitest-environment jsdom
 *
 * specs/automations/list-pages.feature
 * specs/automations/source-merge.feature
 *
 * Covers the WS-6 defects that live on the Automations/Reports list pages
 * (no delete confirmation, delete copy naming the wrong kind, row actions with
 * no accessible name, the Overview tab having no way to create anything —
 * #6716, G5) and the merged list those defects now live on: one table for
 * everything that watches something, whatever it watches (ADR-093 §1).
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { allTriggers } from "./listPages.fixture";

const {
  mockPathnameRef,
  mockOpenDrawer,
  mockDeleteMutate,
  mockToggleMutate,
  mockInvalidateTriggerById,
  mockToastCreate,
} = vi.hoisted(() => ({
  mockPathnameRef: { current: "/test-project/automations" },
  mockOpenDrawer: vi.fn(),
  mockDeleteMutate: vi.fn(),
  mockToggleMutate: vi.fn(),
  mockInvalidateTriggerById: vi.fn(),
  mockToastCreate: vi.fn(),
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
    // The page decides whether a row may offer "Use the project integration"
    // off the caller's project permission.
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
  toaster: { create: mockToastCreate },
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
        useMutation: () => ({ mutate: mockToggleMutate, isLoading: false }),
      },
      deleteById: {
        useMutation: () => ({ mutate: mockDeleteMutate, isLoading: false }),
      },
    },
    dataset: {
      getAll: { useQuery: () => ({ data: [], isLoading: false }) },
    },
    graphs: {
      getAll: { useQuery: () => ({ data: [], isLoading: false }) },
    },
    // ADR-093 §5: the page reads the project's Slack connection once and
    // threads workspace name + switch permission down to the row nudges.
    slackIntegration: {
      getStatus: {
        useQuery: () => ({ data: { connected: false }, isLoading: false }),
      },
    },
    useContext: () => ({
      automation: {
        getTriggerById: { invalidate: mockInvalidateTriggerById },
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

describe("given the unified automations table", () => {
  beforeEach(() => {
    mockPathnameRef.current = "/test-project/automations/automations";
    mockDeleteMutate.mockReset();
    mockInvalidateTriggerById.mockReset();
    mockToastCreate.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  describe("when the project has automations watching a filter and a graph", () => {
    /** @scenario "The unified table lists automations watching filters and graphs together" */
    it("lists both in one table, each saying what it watches and where it delivers", async () => {
      await renderPage();

      const table = within(screen.getByRole("table"));
      // Both former kinds, one table.
      expect(table.getByText("Cost spike")).toBeInTheDocument();
      expect(table.getByText("Flag failures")).toBeInTheDocument();
      // What each row watches.
      expect(table.getByText("Graph · Cost graph")).toBeInTheDocument();
      expect(table.getAllByText("Trace filter").length).toBeGreaterThan(0);
      expect(table.getAllByText("status:error").length).toBeGreaterThan(0);
      // Where each row delivers.
      expect(table.getByText("a@b.com")).toBeInTheDocument();
      expect(
        table.getByText("Slack app · channel C0999999"),
      ).toBeInTheDocument();
    });

    /** @scenario "Reports stay on their own tab" */
    it("keeps reports out of it and lists them on their own tab", async () => {
      const automationsTab = await renderPage();
      expect(screen.queryByText("Weekly digest")).not.toBeInTheDocument();
      automationsTab.unmount();

      mockPathnameRef.current = "/test-project/automations/schedules";
      await renderPage();
      expect(screen.getByText("Weekly digest")).toBeInTheDocument();
    });
  });

  describe("when the user chooses Delete on a graph-watching row", () => {
    /** @scenario "Deleting names the row an automation, whatever it watches" */
    it("names it an automation in the dialog and in the toast", async () => {
      mockDeleteMutate.mockImplementation((_input, opts) => {
        opts.onSuccess();
      });
      const user = userEvent.setup();
      await renderPage();

      await user.click(screen.getByLabelText("Actions for Cost spike"));
      await user.click(
        screen.getByRole("menuitem", { name: /Delete automation Cost spike/ }),
      );

      // Scoped to the dialog itself: the menu's own item can still be
      // mid-exit-animation in the DOM when the dialog mounts, and an unscoped
      // query intermittently matches both and throws.
      const dialog = within(screen.getByRole("dialog"));
      expect(dialog.getByText("Delete automation")).toBeInTheDocument();
      expect(
        dialog.getByText(/This permanently deletes "Cost spike"/),
      ).toBeInTheDocument();
      // Nothing is deleted merely by opening the dialog.
      expect(mockDeleteMutate).not.toHaveBeenCalled();

      await user.click(screen.getByRole("button", { name: "Delete" }));

      expect(mockToastCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Delete automation",
          description: "Automation deleted",
          type: "success",
        }),
      );
    });
  });

  describe("when the user confirms the deletion", () => {
    /** @scenario Confirming the dialog deletes the row and the drawer cache */
    it("deletes the row and invalidates the drawer cache", async () => {
      mockDeleteMutate.mockImplementation((_input, opts) => {
        opts.onSuccess();
      });
      const user = userEvent.setup();
      await renderPage();

      await user.click(screen.getByLabelText("Actions for Cost spike"));
      await user.click(
        screen.getByRole("menuitem", { name: /Delete automation Cost spike/ }),
      );
      await user.click(screen.getByRole("button", { name: "Delete" }));

      expect(mockDeleteMutate).toHaveBeenCalledWith(
        { triggerId: "alert-1", projectId: "proj-1" },
        expect.objectContaining({
          onSuccess: expect.any(Function),
          onError: expect.any(Function),
        }),
      );
      expect(mockInvalidateTriggerById).toHaveBeenCalled();
    });
  });

  describe("when the user dismisses the dialog without confirming", () => {
    /** @scenario Cancelling the dialog leaves the row untouched */
    it("leaves the row untouched", async () => {
      const user = userEvent.setup();
      await renderPage();

      await user.click(screen.getByLabelText("Actions for Cost spike"));
      await user.click(
        screen.getByRole("menuitem", { name: /Delete automation Cost spike/ }),
      );
      await user.click(screen.getByRole("button", { name: "Cancel" }));

      expect(mockDeleteMutate).not.toHaveBeenCalled();
    });
  });

  describe("when the row's actions menu is opened", () => {
    /** @scenario View, Edit, and Delete each have their own accessible name */
    it("exposes an accessible name for View, Edit, and Delete", async () => {
      const user = userEvent.setup();
      await renderPage();

      await user.click(screen.getByLabelText("Actions for Cost spike"));

      expect(
        screen.getByRole("menuitem", { name: /View Cost spike/ }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("menuitem", { name: /Edit Cost spike/ }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("menuitem", { name: /Delete automation Cost spike/ }),
      ).toBeInTheDocument();
    });
  });
});

describe("given the Reports table", () => {
  beforeEach(() => {
    mockPathnameRef.current = "/test-project/automations/schedules";
    mockDeleteMutate.mockReset();
    mockToastCreate.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  describe("when the user deletes a report row", () => {
    /** @scenario Deleting a report names it as a report, not an automation */
    it("names the row a report, not an automation", async () => {
      mockDeleteMutate.mockImplementation((_input, opts) => opts.onSuccess());
      const user = userEvent.setup();
      await renderPage();

      await user.click(screen.getByLabelText("Actions for Weekly digest"));
      await user.click(
        screen.getByRole("menuitem", { name: /Delete report Weekly digest/ }),
      );
      await user.click(screen.getByRole("button", { name: "Delete" }));

      expect(mockToastCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Delete report",
          description: "Report deleted",
        }),
      );
    });
  });
});

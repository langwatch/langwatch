/**
 * @vitest-environment jsdom
 *
 * specs/automations/list-pages.feature
 *
 * Covers the WS-6 defects that live on the Automations/Alerts/Schedules
 * list pages: no delete confirmation, delete copy naming the wrong kind,
 * row actions with no accessible name, and the Overview tab having no way
 * to create anything (#6716, G5).
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const alertTrigger = {
  id: "alert-1",
  name: "Cost spike",
  active: true,
  pausedReason: null,
  customGraphId: "graph-1",
  customGraph: { name: "Cost graph" },
  triggerKind: "TRIGGER",
  action: "SEND_EMAIL",
  actionParams: {
    seriesName: "cost",
    operator: "gt",
    threshold: 10,
    timePeriod: 60,
    members: ["a@b.com"],
  },
  checks: [],
  filterQuery: null,
  filters: "{}",
};

const scheduleTrigger = {
  id: "schedule-1",
  name: "Weekly digest",
  active: true,
  pausedReason: null,
  customGraphId: null,
  customGraph: null,
  triggerKind: "REPORT",
  action: "SEND_EMAIL",
  actionParams: {
    source: { kind: "traceQuery", topN: 5 },
    schedule: { cron: "0 9 * * 1", timezone: "UTC" },
    members: ["a@b.com"],
  },
  checks: [],
  filterQuery: null,
  filters: "{}",
};

const automationTrigger = {
  id: "automation-1",
  name: "Flag failures",
  active: true,
  pausedReason: null,
  customGraphId: null,
  customGraph: null,
  triggerKind: "TRIGGER",
  action: "SEND_SLACK_MESSAGE",
  actionParams: { slackWebhook: "https://hooks.slack.example/x" },
  checks: [],
  filterQuery: "status:error",
  filters: "{}",
};

const botSlackTrigger = {
  id: "automation-2",
  name: "Errors to #ops",
  active: true,
  pausedReason: null,
  customGraphId: null,
  customGraph: null,
  triggerKind: "TRIGGER",
  action: "SEND_SLACK_MESSAGE",
  actionParams: { slackDelivery: "bot", slackChannelId: "C0999999" },
  checks: [],
  filterQuery: "status:error",
  filters: "{}",
};

const allTriggers = [
  alertTrigger,
  scheduleTrigger,
  automationTrigger,
  botSlackTrigger,
];

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

describe("given the Alerts table", () => {
  beforeEach(() => {
    mockPathnameRef.current = "/test-project/automations/alerts";
    mockDeleteMutate.mockReset();
    mockInvalidateTriggerById.mockReset();
    mockToastCreate.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  describe("when the user chooses Delete on an alert row", () => {
    /** @scenario Deleting an alert asks for confirmation and names it as an alert */
    it("asks for confirmation and names the row an alert, not an automation", async () => {
      const user = userEvent.setup();
      await renderPage();

      await user.click(screen.getByLabelText("Actions for Cost spike"));
      await user.click(
        screen.getByRole("menuitem", { name: /Delete alert Cost spike/ }),
      );

      // Scoped to the dialog itself: the menu's own "Delete alert" item can
      // still be mid-exit-animation in the DOM when the dialog mounts, and
      // an unscoped `getByText("Delete alert")` intermittently matches both
      // — the closing menu item and the dialog title — and throws.
      const dialog = within(screen.getByRole("dialog"));
      expect(dialog.getByText("Delete alert")).toBeInTheDocument();
      expect(
        dialog.getByText(/This permanently deletes "Cost spike"/),
      ).toBeInTheDocument();
      // Nothing is deleted merely by opening the dialog.
      expect(mockDeleteMutate).not.toHaveBeenCalled();
    });
  });

  describe("when the user confirms the deletion", () => {
    /** @scenario Confirming the dialog deletes the row and the drawer cache */
    it("deletes the row, invalidates the drawer cache, and names it as an alert", async () => {
      mockDeleteMutate.mockImplementation((_input, opts) => {
        opts.onSuccess();
      });
      const user = userEvent.setup();
      await renderPage();

      await user.click(screen.getByLabelText("Actions for Cost spike"));
      await user.click(
        screen.getByRole("menuitem", { name: /Delete alert Cost spike/ }),
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
      expect(mockToastCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Delete alert",
          description: "Alert deleted",
          type: "success",
        }),
      );
    });
  });

  describe("when the user dismisses the dialog without confirming", () => {
    /** @scenario Cancelling the dialog leaves the row untouched */
    it("leaves the row untouched", async () => {
      const user = userEvent.setup();
      await renderPage();

      await user.click(screen.getByLabelText("Actions for Cost spike"));
      await user.click(
        screen.getByRole("menuitem", { name: /Delete alert Cost spike/ }),
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
        screen.getByRole("menuitem", { name: /Delete alert Cost spike/ }),
      ).toBeInTheDocument();
    });
  });
});

describe("given the Schedules table", () => {
  beforeEach(() => {
    mockPathnameRef.current = "/test-project/automations/schedules";
    mockDeleteMutate.mockReset();
    mockToastCreate.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  describe("when the user deletes a schedule row", () => {
    /** @scenario Deleting a schedule names it as a schedule, not an automation */
    it("names the row a schedule, not an automation", async () => {
      mockDeleteMutate.mockImplementation((_input, opts) => opts.onSuccess());
      const user = userEvent.setup();
      await renderPage();

      await user.click(screen.getByLabelText("Actions for Weekly digest"));
      await user.click(
        screen.getByRole("menuitem", { name: /Delete schedule Weekly digest/ }),
      );
      await user.click(screen.getByRole("button", { name: "Delete" }));

      expect(mockToastCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Delete schedule",
          description: "Schedule deleted",
        }),
      );
    });
  });
});

describe("given the Automations table", () => {
  beforeEach(() => {
    mockPathnameRef.current = "/test-project/automations/automations";
  });

  afterEach(() => {
    cleanup();
  });

  describe("when a row is a bot-delivery Slack automation", () => {
    /** @scenario The Notifies cell names a bot-delivery Slack automation */
    it("names the Slack app and its destination channel, not 'Webhook'", async () => {
      await renderPage();

      // #6244: this cell used to show "Webhook" with an empty tooltip for
      // every Slack row, including bot deliveries that never carry a
      // webhook at all.
      expect(
        screen.getByText("Slack app · channel C0999999"),
      ).toBeInTheDocument();
      expect(screen.queryByText("Webhook")).toBeNull();
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
    /** @scenario The Overview offers creating an automation, alert, or schedule */
    it("offers the three kinds and opens the composer pre-set to each", async () => {
      const user = userEvent.setup();
      await renderPage();

      await user.click(screen.getByRole("button", { name: /Create/ }));

      expect(
        screen.getByRole("menuitem", { name: "New automation" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("menuitem", { name: "New alert" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("menuitem", { name: "New schedule" }),
      ).toBeInTheDocument();

      await user.click(screen.getByRole("menuitem", { name: "New alert" }));
      expect(mockOpenDrawer).toHaveBeenCalledWith("automation", {
        initialSource: "customGraph",
      });
    });
  });
});

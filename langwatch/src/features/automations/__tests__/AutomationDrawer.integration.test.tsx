/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FilterParam } from "~/hooks/useFilterParams";
import type { FilterField } from "~/server/filters/types";
import { AutomationDrawer } from "../AutomationDrawer";
import { useAutomationStore } from "../state/automationStore";

// The saved row the edit-mode query resolves to. Mutable so a test can
// emulate a tRPC background refetch handing back a *different* row after the
// author has begun editing.
let mockTriggerRow: Record<string, unknown> | null = null;
// Hoisted so these mock fns are initialized before any vi.mock factory runs —
// a transitive import (AddParticipants -> ~/utils/api) triggers the api mock
// during the hoisted import graph, before plain `const` declarations execute.
const {
  mockGetTriggerByIdQuery,
  mockCloseDrawer,
  mockInvalidate,
  mockUpsertMutate,
} = vi.hoisted(() => ({
  mockGetTriggerByIdQuery: vi.fn(() => ({
    data: mockTriggerRow,
    isLoading: false,
    error: null,
  })),
  mockCloseDrawer: vi.fn(),
  mockInvalidate: vi.fn(),
  mockUpsertMutate: vi.fn(),
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    closeDrawer: mockCloseDrawer,
    openDrawer: vi.fn(),
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

vi.mock("~/hooks/useFilterParams", () => ({
  useFilterParams: () => ({ filterParams: { filters: {} } }),
}));

vi.mock("~/hooks/useRequiredSession", () => ({
  useRequiredSession: () => ({
    data: { user: { email: "me@example.com" } },
    status: "authenticated",
  }),
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

// FieldsFilters is a heavy popover/virtualizer surface backed by its own
// tRPC queries. The behaviour under test is "the When secondary hands a full
// filter object back up and the main row re-summarises", so stub it down to a
// button that calls setFilters with the full replacement object — exactly the
// shape the real component passes (`{ ...filters, [field]: values }`).
vi.mock("~/components/filters/FieldsFilters", () => ({
  FieldsFilters: ({
    filters,
    setFilters,
  }: {
    filters: Record<FilterField, FilterParam>;
    setFilters: (next: Partial<Record<FilterField, FilterParam>>) => void;
  }) => (
    <button
      type="button"
      data-testid="add-filter"
      onClick={() =>
        setFilters({
          ...filters,
          "metadata.labels": ["production"],
        })
      }
    >
      add filter
    </button>
  ),
}));

vi.mock("~/utils/api", () => ({
  api: {
    automation: {
      getTriggerById: {
        useQuery: () => mockGetTriggerByIdQuery(),
      },
      testFireTemplate: {
        useMutation: () => ({ mutate: vi.fn(), isLoading: false }),
      },
      upsert: {
        useMutation: () => ({ mutate: mockUpsertMutate, isLoading: false }),
      },
      getTriggers: { invalidate: mockInvalidate },
    },
    graphs: {
      getAll: { useQuery: () => ({ data: [], isLoading: false }) },
      getById: {
        useQuery: () => ({ data: null, isLoading: false }),
      },
    },
    useContext: () => ({
      automation: { getTriggers: { invalidate: mockInvalidate } },
    }),
  },
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const renderDrawer = (props: { automationId?: string; source?: string } = {}) =>
  render(<AutomationDrawer {...props} />, { wrapper: Wrapper });

function savedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "trigger-1",
    name: "Saved automation",
    action: "SEND_EMAIL",
    alertType: null,
    customGraphId: null,
    filters: JSON.stringify({ "metadata.labels": ["production"] }),
    notificationCadence: "immediate",
    traceDebounceMs: 5000,
    actionParams: {},
    emailSubjectTemplate: null,
    emailBodyTemplate: null,
    slackTemplate: null,
    slackTemplateType: null,
    ...overrides,
  };
}

describe("AutomationDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTriggerRow = null;
    useAutomationStore.getState().reset();
  });

  afterEach(() => {
    cleanup();
  });

  describe("given a fresh create flow", () => {
    describe("when the draft has no trigger or type yet", () => {
      it("disables the create button", async () => {
        renderDrawer();

        const createButton = await screen.findByRole("button", {
          name: "Create automation",
        });
        expect(createButton).toBeDisabled();
      });

      it("explains why saving is blocked on hover", async () => {
        const user = userEvent.setup();
        renderDrawer();

        const createButton = await screen.findByRole("button", {
          name: "Create automation",
        });
        await user.hover(createButton);

        await waitFor(() => {
          expect(
            screen.getByText(/set a trigger and pick a type/i),
          ).toBeInTheDocument();
        });
      });
    });
  });

  describe("given an existing automation in edit mode", () => {
    describe("when the saved row first resolves", () => {
      it("hydrates the form from the saved row", async () => {
        mockTriggerRow = savedRow();
        renderDrawer({ automationId: "trigger-1" });

        await waitFor(() => {
          expect(useAutomationStore.getState().draft.name).toBe(
            "Saved automation",
          );
        });
        expect(screen.getByText("Edit automation")).toBeInTheDocument();
      });
    });

    describe("when a background refetch returns a changed row after edits", () => {
      it("keeps the in-progress edit instead of clobbering it", async () => {
        mockTriggerRow = savedRow();
        const { rerender } = renderDrawer({ automationId: "trigger-1" });

        await waitFor(() => {
          expect(useAutomationStore.getState().draft.name).toBe(
            "Saved automation",
          );
        });

        // Author edits the name mid-session.
        useAutomationStore
          .getState()
          .dispatch({ type: "SET_NAME", value: "My local edit" });

        // tRPC refetches in the background and hands back a row whose name
        // changed server-side. The hydratedFromServerFor guard must NOT
        // re-hydrate over the local edit.
        mockTriggerRow = savedRow({ name: "Server-changed name" });
        // Re-render the SAME tree — testing-library re-applies the `wrapper`, so
        // the component instance and its `hydratedFromServerFor` ref persist.
        // (Manually re-wrapping in <Wrapper> would double-wrap and remount the
        // drawer, resetting the ref — a test artifact, not a real refetch.)
        rerender(<AutomationDrawer automationId="trigger-1" />);

        await waitFor(() => {
          expect(useAutomationStore.getState().draft.name).toBe(
            "My local edit",
          );
        });
        expect(useAutomationStore.getState().draft.name).not.toBe(
          "Server-changed name",
        );
      });
    });
  });

  describe("given the When secondary is open", () => {
    describe("when a filter is saved from the secondary", () => {
      it("updates the When-row summary on the main drawer", async () => {
        renderDrawer();

        // Open the When secondary.
        fireEvent.click(screen.getByText("When"));

        // The stubbed FieldsFilters hands a full filter object back up.
        await waitFor(() => {
          expect(screen.getByTestId("add-filter")).toBeInTheDocument();
        });
        fireEvent.click(screen.getByTestId("add-filter"));

        // Commit via the secondary's Done action.
        fireEvent.click(screen.getByRole("button", { name: "Done" }));

        // Back on the main drawer the When row now summarises the filter.
        await waitFor(() => {
          expect(
            screen.getByText(/1 condition: metadata\.labels/i),
          ).toBeInTheDocument();
        });
      });
    });
  });

  describe("given the drawer opens with a prefilled graph", () => {
    describe("when the drawer mounts", () => {
      it("initialises the draft into graph-alert mode with the graph + series locked in", async () => {
        renderDrawer({
          prefilledGraphId: "graph-1",
          prefilledSeriesName: "0/latency/p95",
        });

        await waitFor(() => {
          const draft = useAutomationStore.getState().draft;
          expect(draft.source).toBe("customGraph");
          expect(draft.customGraphId).toBe("graph-1");
          expect(draft.graphAlert.seriesName).toBe("0/latency/p95");
        });
      });
    });
  });

  describe("given an existing graph-alert row in edit mode", () => {
    describe("when the saved row first resolves", () => {
      it("hydrates the threshold rule from actionParams", async () => {
        mockTriggerRow = savedRow({
          customGraphId: "graph-7",
          action: "SEND_SLACK_MESSAGE",
          alertType: "CRITICAL",
          filters: JSON.stringify({}),
          actionParams: {
            slackWebhook: "https://hooks.slack.com/services/abc",
            threshold: 0.9,
            operator: "lte",
            timePeriod: 1440,
            seriesName: "0/error_rate/avg",
          },
        });
        renderDrawer({ automationId: "trigger-1" });

        await waitFor(() => {
          const draft = useAutomationStore.getState().draft;
          expect(draft.source).toBe("customGraph");
          expect(draft.customGraphId).toBe("graph-7");
          expect(draft.graphAlert).toEqual({
            threshold: 0.9,
            operator: "lte",
            timePeriod: 1440,
            seriesName: "0/error_rate/avg",
          });
        });
      });
    });
  });
});

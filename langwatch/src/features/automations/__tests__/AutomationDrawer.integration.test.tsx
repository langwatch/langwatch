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
  within,
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
  mockGraphsGetAllInvalidate,
  mockGraphsGetByIdInvalidate,
  mockUpsertMutate,
} = vi.hoisted(() => ({
  mockGetTriggerByIdQuery: vi.fn(() => ({
    data: mockTriggerRow,
    isLoading: false,
    error: null,
  })),
  mockCloseDrawer: vi.fn(),
  mockInvalidate: vi.fn(),
  mockGraphsGetAllInvalidate: vi.fn(),
  mockGraphsGetByIdInvalidate: vi.fn(),
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
    dashboards: {
      getAll: { useQuery: () => ({ data: [], isLoading: false }) },
    },
    // The trace-subject query editor previews matches via tracesV2.list.
    tracesV2: {
      list: {
        useQuery: () => ({ data: undefined, isFetching: false, error: null }),
      },
    },
    useContext: () => ({
      automation: { getTriggers: { invalidate: mockInvalidate } },
      graphs: {
        getAll: { invalidate: mockGraphsGetAllInvalidate },
        getById: { invalidate: mockGraphsGetByIdInvalidate },
      },
    }),
  },
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const renderDrawer = (
  props: {
    automationId?: string;
    source?: string;
    prefilledGraphId?: string;
    prefilledSeriesName?: string;
    initialSource?: string;
    initialName?: string;
    initialAction?: string;
    initialFilters?: string;
  } = {},
) => render(<AutomationDrawer {...props} />, { wrapper: Wrapper });

/** Locates a native select by one of its option labels — the Field labels
 *  aren't programmatically wired to the NativeSelect fields. */
function selectContainingOption(optionName: RegExp): HTMLSelectElement {
  const selects = screen.getAllByRole("combobox") as HTMLSelectElement[];
  const match = selects.find((select) =>
    within(select)
      .queryAllByRole("option")
      .some((option) => optionName.test(option.textContent ?? "")),
  );
  if (!match) throw new Error(`No select with option ${String(optionName)}`);
  return match;
}

function savedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "trigger-1",
    name: "Saved automation",
    action: "SEND_EMAIL",
    alertType: null,
    triggerKind: "AUTOMATION",
    customGraphId: null,
    filters: JSON.stringify({ "metadata.labels": ["production"] }),
    filterQuery: null,
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

/** A saved scheduled REPORT (ADR-044): the row the Reports table opens this
 *  same drawer with — schedule + content source live in `actionParams`, the
 *  trace scope in `filterQuery`. */
function savedReportRow(overrides: Record<string, unknown> = {}) {
  const { actionParams, ...rest } = overrides;
  return savedRow({
    name: "Weekly error digest",
    triggerKind: "REPORT",
    filters: JSON.stringify({}),
    filterQuery: "status:error",
    actionParams: {
      members: ["ops@acme.com"],
      source: { kind: "traceQuery", filters: {}, topN: 10 },
      schedule: { cron: "0 9 * * 1", timezone: "Europe/Amsterdam" },
      compareToPrevious: false,
      ...(actionParams as Record<string, unknown> | undefined),
    },
    ...rest,
  });
}

describe("AutomationDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTriggerRow = null;
    // Restore the default resolved-query shape — tests that emulate a
    // loading / errored edit query override this per-test.
    mockGetTriggerByIdQuery.mockImplementation(() => ({
      data: mockTriggerRow,
      isLoading: false,
      error: null,
    }));
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

        // Facet-ordered todo copy: name, then the trace subject, then delivery.
        await waitFor(() => {
          expect(
            screen.getByText(
              /choose which traces to act on.*pick a delivery channel/i,
            ),
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

    describe("when the saved row is still loading", () => {
      it("shows a skeleton instead of the blank form and disables Save", async () => {
        mockGetTriggerByIdQuery.mockImplementation(() => ({
          data: null,
          isLoading: true,
          isError: false,
          error: null,
        }));
        renderDrawer({ automationId: "trigger-1" });

        expect(
          await screen.findByTestId("automation-edit-loading"),
        ).toBeInTheDocument();
        // The blank form must not render — a keystroke into it would block
        // hydration and let Save overwrite the row with a near-blank draft.
        expect(screen.queryByPlaceholderText(/name/i)).not.toBeInTheDocument();
        expect(
          screen.getByRole("button", { name: "Save changes" }),
        ).toBeDisabled();
      });

      it("swaps the skeleton for the hydrated form once the row lands", async () => {
        mockGetTriggerByIdQuery.mockImplementation(() => ({
          data: null,
          isLoading: true,
          isError: false,
          error: null,
        }));
        const { rerender } = renderDrawer({ automationId: "trigger-1" });
        expect(
          await screen.findByTestId("automation-edit-loading"),
        ).toBeInTheDocument();

        mockTriggerRow = savedRow();
        mockGetTriggerByIdQuery.mockImplementation(() => ({
          data: mockTriggerRow,
          isLoading: false,
          isError: false,
          error: null,
        }));
        rerender(<AutomationDrawer automationId="trigger-1" />);

        await waitFor(() => {
          expect(useAutomationStore.getState().draft.name).toBe(
            "Saved automation",
          );
        });
        expect(
          screen.queryByTestId("automation-edit-loading"),
        ).not.toBeInTheDocument();
      });
    });

    describe("when the saved row fails to load", () => {
      it("shows an error state instead of the form and keeps Save disabled", async () => {
        mockGetTriggerByIdQuery.mockImplementation(() => ({
          data: null,
          isLoading: false,
          isError: true,
          error: new Error("boom"),
        }));
        renderDrawer({ automationId: "trigger-1" });

        expect(
          await screen.findByText(/couldn't load this/i),
        ).toBeInTheDocument();
        expect(
          screen.getByRole("button", { name: "Save changes" }),
        ).toBeDisabled();
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

  describe("given the trace subject is edited inline", () => {
    describe("when a filter query is typed", () => {
      it("records it on the draft filterQuery without opening a secondary", async () => {
        const user = userEvent.setup();
        renderDrawer();

        // The subject facet is inline now — a fresh trace automation authors a
        // Traces-V2 query on the main pane (no "When" secondary to open). The
        // Builder is the default surface; the raw-query input lives behind the
        // Code toggle.
        await user.click(await screen.findByRole("button", { name: "Code" }));
        const input = await screen.findByPlaceholderText(/status:error/i);
        fireEvent.change(input, { target: { value: "status:error" } });

        await waitFor(() => {
          expect(useAutomationStore.getState().draft.filterQuery).toBe(
            "status:error",
          );
        });
      });
    });
  });

  describe("given the drawer opens as a new alert from the page", () => {
    describe("when it mounts with initialSource customGraph", () => {
      it("opens a fresh alert draft with severity defaulted to warning", async () => {
        renderDrawer({ initialSource: "customGraph" });

        await waitFor(() => {
          const draft = useAutomationStore.getState().draft;
          expect(draft.source).toBe("customGraph");
          expect(draft.alertType).toBe("WARNING");
        });
        // No graph is prefilled or locked — the user picks it.
        expect(useAutomationStore.getState().draft.customGraphId).toBeNull();
        expect(screen.getByText("New alert")).toBeInTheDocument();
      });

      it("keeps the graph select enabled so the user picks the graph", async () => {
        renderDrawer({ initialSource: "customGraph" });

        await waitFor(() => {
          expect(useAutomationStore.getState().draft.source).toBe(
            "customGraph",
          );
        });

        // The subject facet is inline — the graph select is on the main pane.
        await waitFor(() => {
          expect(selectContainingOption(/select a graph/i)).toBeEnabled();
        });
      });
    });
  });

  describe("given a use-case card prefill", () => {
    describe("when the params seed an alert", () => {
      it("seeds the name, source, action, and severity", async () => {
        renderDrawer({
          initialSource: "customGraph",
          initialName: "Error spike alert",
          initialAction: "SEND_SLACK_MESSAGE",
        });

        await waitFor(() => {
          const draft = useAutomationStore.getState().draft;
          expect(draft.source).toBe("customGraph");
          expect(draft.name).toBe("Error spike alert");
          expect(draft.action).toBe("SEND_SLACK_MESSAGE");
          expect(draft.alertType).toBe("WARNING");
        });
      });
    });

    describe("when the params seed a trace automation", () => {
      it("seeds the name, action, and filters without switching the source", async () => {
        renderDrawer({
          initialName: "Error dataset",
          initialAction: "ADD_TO_DATASET",
          initialFilters: JSON.stringify({ "traces.error": ["true"] }),
        });

        await waitFor(() => {
          const draft = useAutomationStore.getState().draft;
          expect(draft.name).toBe("Error dataset");
          expect(draft.action).toBe("ADD_TO_DATASET");
          expect(draft.filters).toEqual({ "traces.error": ["true"] });
        });
        expect(useAutomationStore.getState().draft.source).toBe("trace");
        expect(useAutomationStore.getState().draft.alertType).toBeNull();
      });
    });

    describe("when the filters param is malformed JSON", () => {
      it("still seeds the rest and leaves the filters empty", async () => {
        renderDrawer({
          initialName: "Error dataset",
          initialAction: "ADD_TO_DATASET",
          initialFilters: "{not json",
        });

        await waitFor(() => {
          const draft = useAutomationStore.getState().draft;
          expect(draft.name).toBe("Error dataset");
          expect(draft.action).toBe("ADD_TO_DATASET");
        });
        expect(useAutomationStore.getState().draft.filters).toEqual({});
      });
    });
  });

  describe("given severity is an alert-only facet", () => {
    describe("when the draft is an alert", () => {
      it("shows the severity facet", async () => {
        renderDrawer({ initialSource: "customGraph" });

        await waitFor(() => {
          expect(useAutomationStore.getState().draft.source).toBe(
            "customGraph",
          );
        });
        expect(screen.getByText(/Severity/)).toBeInTheDocument();
      });
    });

    describe("when the draft is a trace automation", () => {
      it("does not show a severity facet", async () => {
        renderDrawer();

        // Automations don't carry a severity (ADR-043) — the facet is gone.
        await screen.findByText("Type");
        expect(screen.queryByText(/Severity/)).not.toBeInTheDocument();
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

  describe("given a saved report row in edit mode", () => {
    describe("when the saved row first resolves", () => {
      it("hydrates the report source, schedule, and trace query from the row", async () => {
        mockTriggerRow = savedReportRow();
        renderDrawer({ automationId: "trigger-1" });

        await waitFor(() => {
          const draft = useAutomationStore.getState().draft;
          expect(draft.source).toBe("report");
          expect(draft.report).toEqual({
            sourceKind: "traceQuery",
            customGraphId: null,
            dashboardId: null,
            topN: 10,
            cron: "0 9 * * 1",
            timezone: "Europe/Amsterdam",
          });
        });
        // The trace scope of a "top matching traces" report lives on the row's
        // filterQuery — losing it would silently send the newest traces.
        expect(useAutomationStore.getState().draft.filterQuery).toBe(
          "status:error",
        );
        expect(screen.getByText("Edit schedule")).toBeInTheDocument();
      });

      it("hydrates a graph-source report without stranding a graph alert", async () => {
        mockTriggerRow = savedReportRow({
          actionParams: {
            source: { kind: "customGraph", customGraphId: "graph-9" },
          },
          filterQuery: null,
        });
        renderDrawer({ automationId: "trigger-1" });

        await waitFor(() => {
          const draft = useAutomationStore.getState().draft;
          expect(draft.source).toBe("report");
          expect(draft.report.sourceKind).toBe("customGraph");
          expect(draft.report.customGraphId).toBe("graph-9");
        });
        // The report's graph is its CONTENT, not a watched metric — the draft
        // must not read as a graph alert.
        expect(useAutomationStore.getState().draft.customGraphId).toBeNull();
      });
    });

    describe("when the author saves it unchanged", () => {
      it("sends the report source, schedule, and the authored trace query", async () => {
        const user = userEvent.setup();
        mockTriggerRow = savedReportRow();
        renderDrawer({ automationId: "trigger-1" });

        const saveButton = await screen.findByRole("button", {
          name: "Save schedule",
        });
        await waitFor(() => expect(saveButton).toBeEnabled());
        await user.click(saveButton);

        expect(mockUpsertMutate).toHaveBeenCalledTimes(1);
        expect(mockUpsertMutate.mock.calls[0]?.[0]).toMatchObject({
          triggerId: "trigger-1",
          projectId: "project-1",
          name: "Weekly error digest",
          action: "SEND_EMAIL",
          customGraphId: null,
          graphAlert: undefined,
          filterQuery: "status:error",
          report: {
            source: { kind: "traceQuery", filters: {}, topN: 10 },
            schedule: { cron: "0 9 * * 1", timezone: "Europe/Amsterdam" },
            compareToPrevious: false,
          },
          actionParams: { members: ["ops@acme.com"] },
        });
      });

      it("refreshes the automations list and the dashboard graph cards", async () => {
        const user = userEvent.setup();
        mockUpsertMutate.mockImplementation(
          (_input: unknown, opts?: { onSuccess?: () => void }) =>
            opts?.onSuccess?.(),
        );
        mockTriggerRow = savedReportRow();
        renderDrawer({ automationId: "trigger-1" });

        const saveButton = await screen.findByRole("button", {
          name: "Save schedule",
        });
        await waitFor(() => expect(saveButton).toBeEnabled());
        await user.click(saveButton);

        expect(mockInvalidate).toHaveBeenCalled();
        // A chart card reads its alert state off the graph, not off the
        // trigger list — without these it still offers "Add alert".
        expect(mockGraphsGetAllInvalidate).toHaveBeenCalled();
        expect(mockGraphsGetByIdInvalidate).toHaveBeenCalled();
        mockUpsertMutate.mockReset();
      });
    });

    describe("when the saved schedule fires more often than the floor", () => {
      it("blocks the save instead of scheduling 1440 sends a day", async () => {
        mockTriggerRow = savedReportRow({
          actionParams: {
            schedule: { cron: "* * * * *", timezone: "Europe/Amsterdam" },
          },
        });
        renderDrawer({ automationId: "trigger-1" });

        // The author's cron rehydrates verbatim — a schedule too tight to run
        // is blocked, never silently swapped for a default.
        await waitFor(() => {
          expect(useAutomationStore.getState().draft.report.cron).toBe(
            "* * * * *",
          );
        });
        expect(
          await screen.findByRole("button", { name: "Save schedule" }),
        ).toBeDisabled();
        // And says why, in the cadence field itself.
        expect(
          screen.getByText(/can send at most every 15 minutes/i),
        ).toBeInTheDocument();
      });
    });
  });

  describe("given a trace query is authored before the type is picked", () => {
    describe("when the type switches to report", () => {
      it("keeps the query as the report's trace scope", async () => {
        const user = userEvent.setup();
        renderDrawer();

        // The raw-query input lives behind the Code toggle (Builder default).
        await user.click(await screen.findByRole("button", { name: "Code" }));
        const input = await screen.findByPlaceholderText(/status:error/i);
        fireEvent.change(input, { target: { value: "status:error" } });
        await waitFor(() => {
          expect(useAutomationStore.getState().draft.filterQuery).toBe(
            "status:error",
          );
        });

        await user.click(screen.getByRole("button", { name: /^Schedule/ }));

        await waitFor(() => {
          expect(useAutomationStore.getState().draft.source).toBe("report");
        });
        expect(useAutomationStore.getState().draft.filterQuery).toBe(
          "status:error",
        );
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

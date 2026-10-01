import { TriggerAction } from "@langwatch/automation-contract";
/**
 * @vitest-environment jsdom
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AutomationToast } from "../../../behavior/automation-feedback.ts";
import { AutomationHostProvider } from "../../../model/automation-host.ts";
import { fakeAutomationHost } from "../../../testing.tsx";
import { AutomationDrawer, RegisteredAutomationDrawer } from "../ui/sections/automation-drawer.tsx";
import { useAutomationStore } from "../ui/sections/automation-store.ts";
import { INITIAL_DRAFT } from "../ui/sections/draft-model.ts";

// The saved row the edit-mode query resolves to. Mutable so a test can
// emulate a tRPC background refetch handing back a *different* row after the
// author has begun editing.
let mockTriggerRow: Record<string, unknown> | null = null;
// The row the server holds, as opposed to the client's copy. Invalidating
// `getTriggerById` moves it into the client's copy, as a refetch would.
let mockServerTriggerRow: Record<string, unknown> | null = null;
// Hoisted so these mock fns are initialized before any vi.mock factory runs —
// a transitive import (AddParticipants -> ~/utils/api) triggers the api mock
// during the hoisted import graph, before plain `const` declarations execute.
const {
  mockGetTriggerByIdQuery,
  mockCloseDrawer,
  mockCloseAddressedDrawer,
  mockInvalidate,
  mockGetTriggerByIdInvalidate,
  mockGraphsGetAllInvalidate,
  mockGraphsGetByIdInvalidate,
  mockUpsertMutate,
  mockToastCreate,
} = vi.hoisted(() => ({
  mockGetTriggerByIdQuery: vi.fn(() => ({
    data: mockTriggerRow,
    isLoading: false,
    // Widened so per-test overrides can inject an error (an error-state case
    // sets `error: new Error(...)`); the bare `null` literal would fix the
    // property's type to `null` and reject those overrides.
    error: null as Error | null,
  })),
  mockCloseDrawer: vi.fn(),
  mockCloseAddressedDrawer: vi.fn(),
  mockInvalidate: vi.fn(),
  // Without a seeded server row this is the no-op the other tests expect.
  mockGetTriggerByIdInvalidate: vi.fn(() => {
    if (mockServerTriggerRow) mockTriggerRow = mockServerTriggerRow;
  }),
  mockGraphsGetAllInvalidate: vi.fn(),
  mockGraphsGetByIdInvalidate: vi.fn(),
  mockUpsertMutate: vi.fn(),
  mockToastCreate: vi.fn((_toast: AutomationToast) => {}),
}));

vi.mock("../../../behavior/automation-session.ts", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-1", name: "Proj", slug: "proj" },
    organization: { id: "org-1" },
    team: { slug: "team-1" },
  }),
  useFeatureFlag: () => ({ enabled: false, isLoading: false }),
  useAppBaseUrl: () => "https://app.langwatch.ai",
  useCloseAddressedDrawer: () => mockCloseAddressedDrawer,
}));

vi.mock("../../../behavior/automation-feedback.ts", () => ({
  useAutomationToaster: () => ({ create: mockToastCreate }),
  useShowErrorToast: () => vi.fn(),
  useDescribeError: () => () => "Something went wrong",
}));

vi.mock("../../../behavior/automation-api.ts", () => ({
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
      // Read by the trace-subject preview to warn when a condition would
      // outrun the plan's daily action ceiling.
      getDailyCap: { useQuery: () => ({ data: undefined }) },
    },
    graphs: {
      // Non-empty: an empty list renders the "no custom graphs yet" state
      // instead of the picker the graph-watching tests need.
      getAll: {
        useQuery: () => ({
          data: [{ id: "graph-1", name: "Latency", trigger: null }],
          isLoading: false,
        }),
      },
      getById: {
        useQuery: () => ({ data: null, isLoading: false }),
      },
    },
    dashboards: {
      getAll: { useQuery: () => ({ data: [], isLoading: false }) },
    },
    team: {
      getTeamWithMembers: { useQuery: () => ({ data: undefined, isLoading: false }) },
    },
    // The trace-subject query editor previews matches via traces.list.
    traces: {
      list: {
        useQuery: () => ({ data: undefined, isFetching: false, error: null }),
      },
    },
    useUtils: () => ({
      automation: {
        getTriggers: { invalidate: mockInvalidate },
        getTriggerById: { invalidate: mockGetTriggerByIdInvalidate },
      },
      graphs: {
        getAll: { invalidate: mockGraphsGetAllInvalidate },
        getById: { invalidate: mockGraphsGetByIdInvalidate },
      },
    }),
  },
}));
vi.mock("@langwatch/dataset-client", () => ({
  datasetClient: {
    useUtils: () => ({
      automation: {
        getTriggers: { invalidate: mockInvalidate },
        getTriggerById: { invalidate: mockGetTriggerByIdInvalidate },
      },
      graphs: {
        getAll: { invalidate: mockGraphsGetAllInvalidate },
        getById: { invalidate: mockGraphsGetByIdInvalidate },
      },
    }),
    dataset: {
      getAll: { useQuery: () => ({ data: [], isLoading: false }) },
    },
  },
}));

// ADR-093 §5a: the connections the project lists; read at render, so a test sets it first.
let mockSlackConnections: { id: string; name: string }[] | undefined;

vi.mock("../../../behavior/slack-api.ts", () => ({
  slackApi: {
    slackIntegration: {
      list: {
        useQuery: () => ({
          data: mockSlackConnections
            ? {
                connections: mockSlackConnections,
                canManageProject: false,
                canManageOrganization: false,
              }
            : undefined,
          refetch: vi.fn(),
        }),
      },
    },
  },
}));

let host = fakeAutomationHost();

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <DesignSystemProvider forcedTheme="light">
    <AutomationHostProvider value={host}>{children}</AutomationHostProvider>
  </DesignSystemProvider>
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
) => render(<AutomationDrawer onClose={mockCloseDrawer} {...props} />, { wrapper: Wrapper });

/** Walk a fresh create from Watch to the Review overview, where the whole
 *  automation and the Save button live (ADR-093 §4). */
async function continueToReview(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Continue" }));
  await user.click(await screen.findByRole("button", { name: "Continue" }));
}

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
    mockServerTriggerRow = null;
    // Several tests hand `mutate` a save-simulating implementation.
    mockUpsertMutate.mockReset();
    host = fakeAutomationHost();
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
    describe("when the drawer opens", () => {
      /** @scenario "The wizard opens by asking what to watch" */
      it("asks what the automation should watch, with no type picker", async () => {
        renderDrawer();

        expect(await screen.findByText("What should this automation watch?")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /A trace filter/ })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /A graph/ })).toBeInTheDocument();
        // Choosing what to watch IS the choice that used to be a type card (ADR-093 §1).
        expect(screen.queryByText("Type")).not.toBeInTheDocument();
        expect(screen.queryByText("Source")).not.toBeInTheDocument();
      });
    });

    describe("when the draft reaches the review step with nothing configured", () => {
      let user: ReturnType<typeof userEvent.setup>;
      let createButton: HTMLElement;
      beforeEach(async () => {
        user = userEvent.setup();
        renderDrawer();
        await continueToReview(user);
        createButton = await screen.findByRole("button", { name: "Create automation" });
      });

      it("keeps the create button enabled and says why on click, sending nothing", async () => {
        expect(createButton).toBeEnabled();
        await user.click(createButton);

        expect(mockUpsertMutate).not.toHaveBeenCalled();
        expect(mockToastCreate).toHaveBeenCalledWith({
          title: expect.stringMatching(/^To save, .*pick a delivery channel\.$/),
          type: "warning",
        });
      });

      it("explains why saving is blocked on hover", async () => {
        await user.hover(createButton);

        // Facet-ordered todo copy: name, then the trace subject, then delivery.
        await waitFor(() => {
          expect(
            screen.getByText(/choose which traces to act on.*pick a delivery channel/i),
          ).toBeInTheDocument();
        });
      });
    });

    describe("when the delivery is an annotation queue with no annotator", () => {
      /** @scenario "Saving with an unfinished delivery names what is missing" */
      it("asks for an annotator rather than to complete the setup", async () => {
        const user = userEvent.setup();
        renderDrawer();
        act(() => {
          useAutomationStore.getState().dispatch({
            type: "SET_ACTION",
            value: TriggerAction.ADD_TO_ANNOTATION_QUEUE,
          });
          useAutomationStore.getState().dispatch({ type: "SET_NAME", value: "Label refusals" });
          useAutomationStore.getState().setStep("review");
        });

        await user.click(await screen.findByRole("button", { name: "Create automation" }));

        expect(mockUpsertMutate).not.toHaveBeenCalled();
        expect(mockToastCreate).toHaveBeenCalledWith({
          title: expect.stringMatching(/choose at least one annotator\.$/),
          type: "warning",
        });
        expect(mockToastCreate).not.toHaveBeenCalledWith(
          expect.objectContaining({ title: expect.stringMatching(/complete the setup/) }),
        );
      });
    });

    describe("when a condition row's attribute key is invalid", () => {
      it("keeps the wizard on Watch after Continue", async () => {
        const user = userEvent.setup();
        renderDrawer();

        await user.click(await screen.findByRole("button", { name: "Code" }));
        fireEvent.change(await screen.findByPlaceholderText(/status:error/i), {
          target: { value: "trace.attribute.user_id:premium" },
        });
        await user.click(screen.getByRole("button", { name: "Builder" }));
        fireEvent.change(await screen.findByDisplayValue("user_id"), {
          target: { value: "user id" },
        });
        await user.click(screen.getByRole("button", { name: "Continue" }));

        expect(useAutomationStore.getState().step).toBe("watch");
        expect(screen.getByDisplayValue("user id")).toBeInTheDocument();
      });
    });

    describe("when the author fills in every step for a trace filter", () => {
      /** @scenario "Creating an automation that watches a trace filter" */
      it("shows the whole automation on the review step and saves one that acts on matching traces", async () => {
        const user = userEvent.setup();
        renderDrawer();

        // Watch: the conditions themselves are the subject.
        await user.click(await screen.findByRole("button", { name: "Code" }));
        fireEvent.change(await screen.findByPlaceholderText(/status:error/i), {
          target: { value: "status:error" },
        });
        await user.click(screen.getByRole("button", { name: "Continue" }));

        // Delivery: one channel and its configuration.
        await user.click(await screen.findByText("Email"));
        act(() => {
          useAutomationStore.getState().dispatch({
            type: "SET_SLICE",
            action: TriggerAction.SEND_EMAIL,
            slice: {
              ...useAutomationStore.getState().draft.slices[TriggerAction.SEND_EMAIL],
              members: ["ops@acme.com"],
            },
          });
          useAutomationStore.getState().setSection(null);
        });
        await user.click(await screen.findByRole("button", { name: "Continue" }));

        // Review: what it watches, the delivery and the name, on one screen.
        fireEvent.change(screen.getByPlaceholderText("e.g., Flag failing traces"), {
          target: { value: "Flag failures" },
        });
        expect(screen.getByText("Watches")).toBeInTheDocument();
        expect(screen.getAllByText("Trace filter · status:error").length).toBeGreaterThan(0);
        expect(screen.getAllByText(/email to 1 recipient/).length).toBeGreaterThan(0);

        const createButton = screen.getByRole("button", { name: "Create automation" });
        await waitFor(() => expect(createButton).toBeEnabled());
        await user.click(createButton);

        expect(mockUpsertMutate).toHaveBeenCalledTimes(1);
        expect(mockUpsertMutate.mock.calls[0]?.[0]).toMatchObject({
          name: "Flag failures",
          action: TriggerAction.SEND_EMAIL,
          filterQuery: "status:error",
          customGraphId: null,
          graphAlert: undefined,
        });
      });
    });

    describe("when the author chooses to watch a graph", () => {
      /** @scenario "Creating an automation that watches a graph" */
      it("saves one that fires when the metric crosses the threshold", async () => {
        const user = userEvent.setup();
        renderDrawer();

        await user.click(await screen.findByRole("button", { name: /A graph/ }));
        await waitFor(() => {
          expect(useAutomationStore.getState().draft.source).toBe("customGraph");
        });
        // The graph, the series and the threshold rule all live in this one step.
        act(() => {
          const { dispatch } = useAutomationStore.getState();
          dispatch({ type: "SET_CUSTOM_GRAPH_ID", value: "graph-1" });
          dispatch({
            type: "SET_GRAPH_ALERT",
            value: { seriesName: "0/latency/p95", operator: "gt", threshold: 250, timePeriod: 60 },
          });
          dispatch({ type: "SET_ACTION", value: TriggerAction.SEND_EMAIL });
          dispatch({
            type: "SET_SLICE",
            action: TriggerAction.SEND_EMAIL,
            slice: {
              ...useAutomationStore.getState().draft.slices[TriggerAction.SEND_EMAIL],
              members: ["ops@acme.com"],
            },
          });
          dispatch({ type: "SET_NAME", value: "Latency watch" });
          useAutomationStore.getState().setStep("review");
        });

        const createButton = await screen.findByRole("button", { name: "Create automation" });
        await waitFor(() => expect(createButton).toBeEnabled());
        await user.click(createButton);

        expect(mockUpsertMutate.mock.calls[0]?.[0]).toMatchObject({
          name: "Latency watch",
          customGraphId: "graph-1",
          graphAlert: {
            seriesName: "0/latency/p95",
            operator: "gt",
            threshold: 250,
            timePeriod: 60,
          },
        });
      });
    });

    describe("when the author closes the wizard part-way through", () => {
      /** @scenario "Abandoning a create persists nothing" */
      it("creates no automation", async () => {
        const user = userEvent.setup();
        renderDrawer();

        await user.click(await screen.findByRole("button", { name: "Code" }));
        fireEvent.change(await screen.findByPlaceholderText(/status:error/i), {
          target: { value: "status:error" },
        });
        await user.click(screen.getByRole("button", { name: "Continue" }));
        await user.click(await screen.findByRole("button", { name: /close/i }));
        await user.click(await screen.findByRole("button", { name: "Discard" }));

        expect(mockUpsertMutate).not.toHaveBeenCalled();
        expect(mockCloseDrawer).toHaveBeenCalled();
      });
    });

    describe("when the drawer is reopened with a different create prefill", () => {
      it("applies the new prefill instead of skipping on the previous opening's latch", async () => {
        const opened = renderDrawer({ prefilledGraphId: "graph-1" });
        await waitFor(() => {
          expect(useAutomationStore.getState().draft.customGraphId).toBe("graph-1");
        });

        // Same drawer reopened with new params: no remount, only the identity changes.
        opened.rerender(<AutomationDrawer onClose={mockCloseDrawer} prefilledGraphId="graph-2" />);

        await waitFor(() => {
          expect(useAutomationStore.getState().draft.customGraphId).toBe("graph-2");
        });
      });
    });
  });

  // React replays every effect once on mount in development (StrictMode):
  // setup, cleanup, setup. The draft outlives the drawer in a singleton store,
  // so anything that decides "reset or keep" has to answer the same way each
  // time or the replay wipes a draft the author is coming back to.
  describe("given the drawer opened straight from an address, which carries no onClose", () => {
    describe("when the author closes an untouched create", () => {
      it("closes the drawer its address names", async () => {
        const user = userEvent.setup();
        render(<RegisteredAutomationDrawer />, { wrapper: Wrapper });

        await user.click(await screen.findByRole("button", { name: /close/i }));

        expect(mockCloseAddressedDrawer).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("given React replays the drawer's effects, as it does in development", () => {
    // StrictMode has to sit OUTSIDE the Chakra provider. Nested inside it, the
    // replay never runs and the test passes against the bug it is written for.
    // That also rules out the `wrapper` render option, which always puts the
    // provider on the outside.
    const renderReplayed = () =>
      render(
        <StrictMode>
          <Wrapper>
            <AutomationDrawer onClose={mockCloseDrawer} />
          </Wrapper>
        </StrictMode>,
      );

    const writeDraft = (name: string) =>
      act(() => {
        useAutomationStore.getState().dispatch({ type: "SET_NAME", value: name });
      });

    describe("when the drawer opens", () => {
      // The sub-flow half of this pair is gone (creating a dataset opened
      // another feature's overlay with no return leg). What survives is
      // the invariant: a draft left in the singleton store never seeds
      // the next open -- the one a StrictMode replay can still break.
      it("starts blank, so a draft left in the store cannot seed it", () => {
        writeDraft("Abandoned draft");

        renderReplayed();

        expect(useAutomationStore.getState().draft.name).toBe("");
      });
    });
  });

  describe("given an existing automation in edit mode", () => {
    describe("when the saved row first resolves", () => {
      /** @scenario "Provider authoring uses one browser surface" */
      /** @scenario "Editing an automation opens the review overview" */
      it("hydrates the form from the saved row and opens on the review overview", async () => {
        mockTriggerRow = savedRow();
        renderDrawer({ automationId: "trigger-1" });

        await waitFor(() => {
          expect(useAutomationStore.getState().draft.name).toBe("Saved automation");
        });
        expect(screen.getByText("Edit automation")).toBeInTheDocument();
        // The drawer itself lands an edit on the overview, never the first step.
        expect(useAutomationStore.getState().step).toBe("review");
        expect(await screen.findByText("Watches")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Edit delivery" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument();
      });

      it("hydrates canonical object filters without dropping them", async () => {
        mockTriggerRow = savedRow({
          filters: { "metadata.labels": ["production"] },
        });
        renderDrawer({ automationId: "trigger-1" });

        await waitFor(() => {
          expect(useAutomationStore.getState().draft.filters).toEqual({
            "metadata.labels": ["production"],
          });
        });
      });
    });

    describe("when the author starts a new automation from the locked watch step", () => {
      it("opens a pristine create instead of carrying the edited draft into it", async () => {
        mockTriggerRow = savedRow({ filterQuery: "status:error", filters: JSON.stringify({}) });
        const opened = renderDrawer({ automationId: "trigger-1" });
        await waitFor(() => {
          expect(useAutomationStore.getState().draft.name).toBe("Saved automation");
        });

        // "New automation" replaces the params in place rather than remounting,
        // so the instance, the store and every latch survive the transition.
        mockTriggerRow = null;
        opened.rerender(<AutomationDrawer onClose={mockCloseDrawer} />);

        await waitFor(() => {
          expect(useAutomationStore.getState().draft).toEqual(INITIAL_DRAFT);
        });
        const draft = useAutomationStore.getState().draft;
        // The specific leaks that produced a duplicate row on Save.
        expect(draft.name).toBe("");
        expect(draft.filterQuery).toBeNull();
        expect(draft.action).toBeNull();
        expect(useAutomationStore.getState().step).toBe("watch");
        expect(await screen.findByText("What should this automation watch?")).toBeInTheDocument();
        expect(screen.getByText("Add automation")).toBeInTheDocument();
      });

      it("re-arms the close guard, so work done in the new one is not dropped silently", async () => {
        const user = userEvent.setup();
        mockTriggerRow = savedRow();
        const opened = renderDrawer({ automationId: "trigger-1" });
        await waitFor(() => {
          expect(useAutomationStore.getState().draft.name).toBe("Saved automation");
        });

        mockTriggerRow = null;
        opened.rerender(<AutomationDrawer onClose={mockCloseDrawer} />);
        await waitFor(() => {
          expect(useAutomationStore.getState().draft).toEqual(INITIAL_DRAFT);
        });

        // The guard's baseline is captured on mount; this transition is not one.
        fireEvent.change(await screen.findByPlaceholderText("e.g., Flag failing traces"), {
          target: { value: "A new automation" },
        });
        await user.click(await screen.findByRole("button", { name: /close/i }));

        expect(await screen.findByText("Discard unsaved changes?")).toBeInTheDocument();
        expect(mockCloseDrawer).not.toHaveBeenCalled();

        // Discarding still closes it: the guard is a prompt, not a trap.
        await user.click(screen.getByRole("button", { name: "Discard" }));
        expect(mockCloseDrawer).toHaveBeenCalled();
      });

      it("asks before discarding unsaved edits, then starts the new automation", async () => {
        const user = userEvent.setup();
        mockTriggerRow = savedRow();
        renderDrawer({ automationId: "trigger-1" });
        await waitFor(() => {
          expect(useAutomationStore.getState().draft.name).toBe("Saved automation");
        });
        act(() => {
          useAutomationStore.getState().dispatch({ type: "SET_NAME", value: "Renamed automation" });
        });

        await user.click(
          await screen.findByRole("button", { name: "Edit what this automation watches" }),
        );
        await user.click(await screen.findByRole("button", { name: "New automation" }));

        expect(await screen.findByText("Discard unsaved changes?")).toBeInTheDocument();
        expect(host.recording.drawerOpens).toEqual([]);

        await user.click(screen.getByRole("button", { name: "Discard" }));
        expect(host.recording.drawerOpens).toEqual([{ drawer: "automation", params: {} }]);
        expect(mockCloseDrawer).not.toHaveBeenCalled();
      });

      it("hydrates the next automation when the drawer moves straight from one to another", async () => {
        mockTriggerRow = savedRow({ name: "First automation" });
        const opened = renderDrawer({ automationId: "trigger-1" });
        await waitFor(() => {
          expect(useAutomationStore.getState().draft.name).toBe("First automation");
        });

        // The next row is already cached, so hydration runs in the same commit
        // as the reset; hydration declared first would latch on the old draft.
        mockTriggerRow = savedRow({ id: "trigger-2", name: "Second automation" });
        opened.rerender(<AutomationDrawer onClose={mockCloseDrawer} automationId="trigger-2" />);

        await waitFor(() => {
          expect(useAutomationStore.getState().draft.name).toBe("Second automation");
        });
        expect(useAutomationStore.getState().step).toBe("review");
      });
    });

    describe("when the author edits one section and finishes", () => {
      /** @scenario "Editing one section returns to the overview" */
      it("comes back to the review overview with the other sections unchanged", async () => {
        const user = userEvent.setup();
        mockTriggerRow = savedRow();
        renderDrawer({ automationId: "trigger-1" });
        await waitFor(() => {
          expect(useAutomationStore.getState().draft.name).toBe("Saved automation");
        });
        const filtersBefore = useAutomationStore.getState().draft.filters;

        // Editing is hub-and-spoke: this enters the delivery step alone.
        await user.click(await screen.findByRole("button", { name: "Edit delivery" }));
        act(() => {
          useAutomationStore.getState().dispatch({
            type: "SET_SLICE",
            action: TriggerAction.SEND_EMAIL,
            slice: {
              ...useAutomationStore.getState().draft.slices[TriggerAction.SEND_EMAIL],
              members: ["ops@acme.com"],
            },
          });
          useAutomationStore.getState().setSection(null);
        });
        await user.click(await screen.findByRole("button", { name: "Done" }));

        expect(await screen.findByText("Watches")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument();
        expect(useAutomationStore.getState().draft.filters).toEqual(filtersBefore);
        expect(useAutomationStore.getState().draft.name).toBe("Saved automation");
      });
    });

    describe("when the author closes the wizard without saving", () => {
      /** @scenario "Abandoning an edit persists nothing" */
      it("leaves the stored automation untouched", async () => {
        const user = userEvent.setup();
        mockTriggerRow = savedRow();
        renderDrawer({ automationId: "trigger-1" });
        await waitFor(() => {
          expect(useAutomationStore.getState().draft.name).toBe("Saved automation");
        });

        fireEvent.change(screen.getByDisplayValue("Saved automation"), {
          target: { value: "Renamed but never saved" },
        });
        await user.click(await screen.findByRole("button", { name: /close/i }));
        await user.click(await screen.findByRole("button", { name: "Discard" }));

        expect(mockUpsertMutate).not.toHaveBeenCalled();
        expect(mockCloseDrawer).toHaveBeenCalled();
      });
    });

    describe("given a saved Slack automation", () => {
      const slackRow = () =>
        savedRow({
          action: "SEND_SLACK_MESSAGE",
          actionParams: {
            slackIntegrationId: "conn-bot",
            slackDelivery: "bot",
            slackChannelId: "C0123",
          },
        });

      afterEach(() => {
        mockSlackConnections = undefined;
      });

      it("names the connection on the review line without opening the Slack step", async () => {
        mockSlackConnections = [{ id: "conn-bot", name: "Alerts bot" }];
        mockTriggerRow = slackRow();
        renderDrawer({ automationId: "trigger-1" });

        expect(await screen.findByText("Slack → Alerts bot #C0123")).toBeInTheDocument();
      });

      it("names it when the list arrives later, and closing without edits does not prompt", async () => {
        const user = userEvent.setup();
        mockSlackConnections = undefined;
        mockTriggerRow = slackRow();
        const opened = renderDrawer({ automationId: "trigger-1" });
        expect(await screen.findByText("Slack connection #C0123")).toBeInTheDocument();

        mockSlackConnections = [{ id: "conn-bot", name: "Alerts bot" }];
        opened.rerender(<AutomationDrawer onClose={mockCloseDrawer} automationId="trigger-1" />);
        expect(await screen.findByText("Slack → Alerts bot #C0123")).toBeInTheDocument();

        await user.click(await screen.findByRole("button", { name: /close/i }));

        expect(screen.queryByText("Discard unsaved changes?")).not.toBeInTheDocument();
        expect(mockCloseDrawer).toHaveBeenCalled();
      });
    });

    describe("when the saved row is still loading", () => {
      it("shows a skeleton instead of the blank form and refuses to save", async () => {
        mockGetTriggerByIdQuery.mockImplementation(() => ({
          data: null,
          isLoading: true,
          isError: false,
          error: null,
        }));
        renderDrawer({ automationId: "trigger-1" });

        expect(await screen.findByTestId("automation-edit-loading")).toBeInTheDocument();
        // The blank form must not render — a keystroke into it would block
        // hydration and let Save overwrite the row with a near-blank draft.
        expect(screen.queryByPlaceholderText(/name/i)).not.toBeInTheDocument();
        await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
        expect(mockUpsertMutate).not.toHaveBeenCalled();
        expect(mockToastCreate).toHaveBeenCalledWith({
          title: "This automation can't be saved until it has loaded.",
          type: "warning",
        });
      });

      it("swaps the skeleton for the hydrated form once the row lands", async () => {
        mockGetTriggerByIdQuery.mockImplementation(() => ({
          data: null,
          isLoading: true,
          isError: false,
          error: null,
        }));
        const { rerender } = renderDrawer({ automationId: "trigger-1" });
        expect(await screen.findByTestId("automation-edit-loading")).toBeInTheDocument();

        mockTriggerRow = savedRow();
        mockGetTriggerByIdQuery.mockImplementation(() => ({
          data: mockTriggerRow,
          isLoading: false,
          isError: false,
          error: null,
        }));
        rerender(<AutomationDrawer onClose={mockCloseDrawer} automationId="trigger-1" />);

        await waitFor(() => {
          expect(useAutomationStore.getState().draft.name).toBe("Saved automation");
        });
        expect(screen.queryByTestId("automation-edit-loading")).not.toBeInTheDocument();
      });
    });

    describe("when the saved row fails to load", () => {
      it("shows an error state instead of the form and refuses to save", async () => {
        mockGetTriggerByIdQuery.mockImplementation(() => ({
          data: null,
          isLoading: false,
          isError: true,
          error: new Error("boom"),
        }));
        renderDrawer({ automationId: "trigger-1" });

        expect(await screen.findByText(/couldn't load this/i)).toBeInTheDocument();
        await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
        expect(mockUpsertMutate).not.toHaveBeenCalled();
      });
    });

    describe("when a background refetch returns a changed row after edits", () => {
      it("keeps the in-progress edit instead of clobbering it", async () => {
        mockTriggerRow = savedRow();
        const { rerender } = renderDrawer({ automationId: "trigger-1" });

        await waitFor(() => {
          expect(useAutomationStore.getState().draft.name).toBe("Saved automation");
        });

        // Author edits the name mid-session.
        useAutomationStore.getState().dispatch({ type: "SET_NAME", value: "My local edit" });

        // tRPC refetches in the background and hands back a row whose name
        // changed server-side. The hydratedFromServerFor guard must NOT
        // re-hydrate over the local edit.
        mockTriggerRow = savedRow({ name: "Server-changed name" });
        // Re-render the SAME tree — testing-library re-applies the `wrapper`, so
        // the component instance and its `hydratedFromServerFor` ref persist.
        // (Manually re-wrapping in <Wrapper> would double-wrap and remount the
        // drawer, resetting the ref — a test artifact, not a real refetch.)
        rerender(<AutomationDrawer onClose={mockCloseDrawer} automationId="trigger-1" />);

        await waitFor(() => {
          expect(useAutomationStore.getState().draft.name).toBe("My local edit");
        });
        expect(useAutomationStore.getState().draft.name).not.toBe("Server-changed name");
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
          expect(useAutomationStore.getState().draft.filterQuery).toBe("status:error");
        });
      });
    });
  });

  describe("given the drawer opens to watch a graph from the page", () => {
    describe("when it mounts with initialSource customGraph", () => {
      it("opens a fresh graph-watching draft with severity defaulted to warning", async () => {
        renderDrawer({ initialSource: "customGraph" });

        await waitFor(() => {
          const draft = useAutomationStore.getState().draft;
          expect(draft.source).toBe("customGraph");
          expect(draft.alertType).toBe("WARNING");
        });
        // No graph is prefilled or locked — the user picks it.
        expect(useAutomationStore.getState().draft.customGraphId).toBeNull();
        // One noun for both subjects: nothing calls this an alert (ADR-093 §1).
        expect(screen.getByText("Add automation")).toBeInTheDocument();
        expect(screen.queryByText("New alert")).not.toBeInTheDocument();
      });

      it("keeps the graph select enabled so the user picks the graph", async () => {
        renderDrawer({ initialSource: "customGraph" });

        await waitFor(() => {
          expect(useAutomationStore.getState().draft.source).toBe("customGraph");
        });

        // The subject facet is inline — the graph select is on the main pane.
        await waitFor(() => {
          expect(selectContainingOption(/select a graph/i)).toBeEnabled();
        });
      });
    });
  });

  describe("given a use-case card prefill", () => {
    describe("when a param seeds the webhook action", () => {
      it("seeds the draft with it, since every project delivers on webhooks", async () => {
        renderDrawer({ initialAction: "SEND_WEBHOOK" });

        await waitFor(() => {
          expect(useAutomationStore.getState().draft.action).toBe("SEND_WEBHOOK");
        });
      });
    });

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

  describe("given severity is offered only to graph-watching automations", () => {
    describe("when the draft watches a graph", () => {
      it("shows the severity facet on the review overview", async () => {
        const user = userEvent.setup();
        renderDrawer({ initialSource: "customGraph" });

        await waitFor(() => {
          expect(useAutomationStore.getState().draft.source).toBe("customGraph");
        });
        await continueToReview(user);

        expect(screen.getByText(/Severity/)).toBeInTheDocument();
      });
    });

    describe("when the draft watches a trace filter", () => {
      it("does not show a severity facet", async () => {
        const user = userEvent.setup();
        renderDrawer();
        await continueToReview(user);

        // A trace-watching automation carries no severity (ADR-043).
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
        expect(useAutomationStore.getState().draft.filterQuery).toBe("status:error");
        expect(screen.getByText("Edit report")).toBeInTheDocument();
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
          name: "Save report",
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
        mockUpsertMutate.mockImplementation((_input: unknown, opts?: { onSuccess?: () => void }) =>
          opts?.onSuccess?.(),
        );
        mockTriggerRow = savedReportRow();
        renderDrawer({ automationId: "trigger-1" });

        const saveButton = await screen.findByRole("button", {
          name: "Save report",
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
          expect(useAutomationStore.getState().draft.report.cron).toBe("* * * * *");
        });
        await userEvent.click(await screen.findByRole("button", { name: "Save report" }));
        expect(mockUpsertMutate).not.toHaveBeenCalled();
        // And says why, in the cadence field itself.
        expect(screen.getByText(/can send at most every 15 minutes/i)).toBeInTheDocument();
      });
    });
  });

  describe("given the author moves back to an earlier step", () => {
    describe("when the watch step is reopened from the rail", () => {
      /** @scenario "The wizard keeps completed steps in view" */
      it("summarises the completed step, reopens it, and keeps the later answers", async () => {
        const user = userEvent.setup();
        renderDrawer();

        // The raw-query input lives behind the Code toggle (Builder default).
        await user.click(await screen.findByRole("button", { name: "Code" }));
        const input = await screen.findByPlaceholderText(/status:error/i);
        fireEvent.change(input, { target: { value: "status:error" } });
        await waitFor(() => {
          expect(useAutomationStore.getState().draft.filterQuery).toBe("status:error");
        });

        await user.click(screen.getByRole("button", { name: "Continue" }));

        // The step behind the author collapses to a one-line summary.
        expect(
          await screen.findByRole("button", { name: /Watch.*Trace filter · status:error/ }),
        ).toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "Continue" }));
        fireEvent.change(screen.getByPlaceholderText("e.g., Flag failing traces"), {
          target: { value: "Flag failures" },
        });

        // An earlier step is one click away, and returning loses nothing.
        await user.click(screen.getByRole("button", { name: /^Watch/ }));

        expect(await screen.findByText("What should this automation watch?")).toBeInTheDocument();
        expect(useAutomationStore.getState().draft.name).toBe("Flag failures");
        expect(useAutomationStore.getState().draft.filterQuery).toBe("status:error");
      });
    });
  });

  describe("given a saved automation is changed and saved", () => {
    describe("when the author opens that same automation again", () => {
      /** @scenario "Editing an automation shows the values that were last saved" */
      it("shows the value that was saved, not the one it replaced", async () => {
        const user = userEvent.setup();
        mockServerTriggerRow = savedReportRow();
        mockTriggerRow = mockServerTriggerRow;
        mockUpsertMutate.mockImplementation(
          (input: { name: string }, opts?: { onSuccess?: (saved: { id: string }) => void }) => {
            mockServerTriggerRow = savedReportRow({ name: input.name });
            opts?.onSuccess?.({ id: "trigger-1" });
          },
        );

        const firstOpen = renderDrawer({ automationId: "trigger-1" });
        const nameInput = await screen.findByDisplayValue("Weekly error digest");
        fireEvent.change(nameInput, { target: { value: "Monday quality digest" } });
        const saveButton = screen.getByRole("button", { name: "Save report" });
        await waitFor(() => expect(saveButton).toBeEnabled());
        await user.click(saveButton);

        // Reopening is a fresh mount: only the row read back can fill the name.
        firstOpen.unmount();
        renderDrawer({ automationId: "trigger-1" });

        expect(await screen.findByDisplayValue("Monday quality digest")).toBeInTheDocument();
        expect(screen.queryByDisplayValue("Weekly error digest")).not.toBeInTheDocument();
      });
    });
  });

  describe("given a fully configured new automation", () => {
    describe("when the author creates it", () => {
      /** @scenario "The creation toast links to the created automation" */
      it("offers to open the automation that was created", async () => {
        const user = userEvent.setup();
        mockUpsertMutate.mockImplementation(
          (_input: unknown, opts?: { onSuccess?: (saved: { id: string }) => void }) =>
            opts?.onSuccess?.({ id: "trigger-created" }),
        );
        renderDrawer();
        act(() => {
          useAutomationStore.getState().hydrate({
            ...INITIAL_DRAFT,
            name: "Flag failing traces",
            action: TriggerAction.SEND_EMAIL,
            filterQuery: "status:error",
            slices: {
              ...INITIAL_DRAFT.slices,
              [TriggerAction.SEND_EMAIL]: {
                ...INITIAL_DRAFT.slices[TriggerAction.SEND_EMAIL],
                members: ["ops@acme.com"],
              },
            },
          });
        });
        await continueToReview(user);

        const createButton = await screen.findByRole("button", { name: "Create automation" });
        await waitFor(() => expect(createButton).toBeEnabled());
        await user.click(createButton);

        const created = mockToastCreate.mock.calls.map(([toast]) => toast).find((t) => t.action);
        expect(created?.action?.label).toBe("View automation");

        created?.action?.run();
        expect(host.recording.drawerOpens).toEqual([
          { drawer: "viewAutomation", params: { automationId: "trigger-created" } },
        ]);
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

describe("given the Edit automation link an alert email carries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    host = fakeAutomationHost();
    mockServerTriggerRow = null;
    mockGetTriggerByIdQuery.mockImplementation(() => ({
      data: mockTriggerRow,
      isLoading: false,
      error: null,
    }));
    useAutomationStore.getState().reset();
  });

  afterEach(cleanup);

  describe("when the recipient follows it into the application", () => {
    /** @scenario "An alert email's Edit automation link opens the automation it names" */
    it("opens the named automation and says the reader arrived from an email", async () => {
      mockTriggerRow = savedRow({ name: "Refund errors" });

      renderDrawer({ automationId: "trigger-1", source: "email-link" });

      expect(await screen.findByText(/Opened from an email notification/)).toBeInTheDocument();
      expect(await screen.findByDisplayValue("Refund errors")).toBeInTheDocument();
    });
  });
});

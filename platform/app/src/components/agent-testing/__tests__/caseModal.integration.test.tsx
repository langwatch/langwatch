/**
 * @vitest-environment jsdom
 *
 * The scenario dialog of the Agent Testing page: what it asks, what its
 * footer holds, what its chips open, and what Save and Run does.
 *
 * @see specs/features/agent-testing/cases-table.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentTestingCaseEditor } from "../cases/AgentTestingCaseEditor";
import { AgentTestingCaseEditorDrawer } from "../cases/AgentTestingCaseEditorDrawer";

const mockCreate = vi.hoisted(() => vi.fn());
const mockUpdate = vi.hoisted(() => vi.fn());
const mockGetById = vi.hoisted(() => vi.fn());
const mockTestSuitesGetAll = vi.hoisted(() => vi.fn());
const mockListVersions = vi.hoisted(() => vi.fn());
const mockOpenDrawer = vi.hoisted(() => vi.fn());

const emptyQuery = vi.hoisted(() => () => ({
  data: undefined,
  isLoading: false,
}));

const onSuccessOf = vi.hoisted(
  () =>
    (mutate: (...args: unknown[]) => void) =>
    ({ onSuccess }: { onSuccess?: (saved: unknown) => void } = {}) => ({
      mutate: (input: unknown) => {
        mutate(input);
        onSuccess?.({
          id: "case_saved",
          name: "Angry customer",
          version: 5,
        });
      },
      isPending: false,
    }),
);

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      scenarios: {
        getAll: { invalidate: vi.fn() },
        getById: { invalidate: vi.fn(), setData: vi.fn() },
        getBatchRunData: { fetch: vi.fn(async () => ({ runs: [] })) },
      },
      suites: {
        testSuites: { getAll: { invalidate: vi.fn() } },
        getById: { invalidate: vi.fn() },
      },
    }),
    scenarios: {
      // The run dialog reads the configurations its scope already ran with.
      getRunConfigurations: {
        useQuery: () => ({ data: [], isLoading: false }),
      },
      getAll: { useQuery: emptyQuery },
      getById: { useQuery: mockGetById },
      getLastResultSummaries: { useQuery: emptyQuery },
      listVersions: { useQuery: mockListVersions },
      getVersion: { useQuery: emptyQuery },
      restoreVersion: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
      create: { useMutation: onSuccessOf(mockCreate) },
      update: { useMutation: onSuccessOf(mockUpdate) },
    },
    suites: {
      testSuites: { getAll: { useQuery: mockTestSuitesGetAll } },
      getAll: { useQuery: emptyQuery },
      getSummaries: { useQuery: emptyQuery },
      update: { useMutation: () => ({ mutateAsync: vi.fn() }) },
      run: { useMutation: () => ({ mutateAsync: vi.fn() }) },
      runPlan: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    },
    agents: { getAll: { useQuery: () => ({ data: [] }) } },
    prompts: { getAllPromptsForProject: { useQuery: () => ({ data: [] }) } },
    modelProvider: {
      listAllForProjectForFrontend: { useQuery: emptyQuery },
      getResolvedDefault: { useQuery: emptyQuery },
    },
  },
}));

vi.mock("~/hooks/useRunScenario", () => ({
  useRunScenario: () => ({ runScenario: vi.fn(), isRunning: false }),
}));

vi.mock("~/hooks/useModelProvidersSettings", () => ({
  useModelProvidersSettings: () => ({ hasEnabledProviders: true }),
}));

vi.mock("~/hooks/useCan", () => ({
  useCan: () => ({ can: () => true, isLoading: false, permissions: [] }),
}));

const mockDrawerParams = vi.hoisted(() => ({
  current: {} as Record<string, string>,
}));
const mockDrawerOpenFor = vi.hoisted(() => ({ current: "" }));
const flowCallbacksStore = vi.hoisted(
  () => ({}) as Record<string, Record<string, unknown>>,
);

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    openDrawer: mockOpenDrawer,
    closeDrawer: () => {
      mockDrawerOpenFor.current = "";
    },
    drawerOpen: (drawer: string) => drawer === mockDrawerOpenFor.current,
    setFlowCallbacks: (drawer: string, callbacks: Record<string, unknown>) => {
      flowCallbacksStore[drawer] = callbacks;
    },
  }),
  useDrawerParams: () => mockDrawerParams.current,
  getFlowCallbacks: (drawer: string) => flowCallbacksStore[drawer],
  setFlowCallbacks: (drawer: string, callbacks: Record<string, unknown>) => {
    flowCallbacksStore[drawer] = callbacks;
  },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj_1", slug: "test-project" },
    organization: { id: "org_1" },
    projectId: "proj_1",
  }),
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    query: { project: "test-project" },
    asPath: "/test-project/agent-testing",
    push: vi.fn(),
    isReady: true,
  }),
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const REFUNDS = { id: "suite_refunds", name: "Refunds", slug: "refunds" };

function storedCase(overrides: Record<string, unknown> = {}) {
  return {
    id: "case_1",
    name: "Double charge",
    situation: "The customer was charged twice.",
    criteria: ["Refunds the second charge"],
    labels: [],
    parameters: null,
    testSuiteId: REFUNDS.id,
    simulatorModel: null,
    judgeModel: null,
    maxTurns: null,
    minTurns: null,
    version: 4,
    ...overrides,
  };
}

function openDrawerAs(params: {
  scenarioId?: string;
  testSuiteId?: string;
  showHistory?: string;
}) {
  mockDrawerParams.current = { ...params } as Record<string, string>;
  mockDrawerOpenFor.current = "agentTestingCaseEditor";
}

describe("the scenario dialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDrawerParams.current = {};
    mockDrawerOpenFor.current = "";
    mockTestSuitesGetAll.mockReturnValue({ data: [REFUNDS], isLoading: false });
    mockGetById.mockReturnValue({
      data: undefined,
      isLoading: false,
      refetch: vi.fn(),
    });
  });

  afterEach(cleanup);

  const openNew = () => {
    openDrawerAs({ testSuiteId: REFUNDS.id });
    render(
      <>
        <AgentTestingCaseEditor />
        <AgentTestingCaseEditorDrawer />
      </>,
      { wrapper: Wrapper },
    );
  };

  describe("when a new scenario is written", () => {
    /** @scenario "New scenario opens the scenario dialog straight away" */
    it("opens on the form itself, with no model-writing step first", async () => {
      openNew();

      const dialog = await screen.findByTestId("case-modal");
      expect(await screen.findByText("New scenario")).toBeInTheDocument();
      expect(screen.getByLabelText("Title")).toBeInTheDocument();
      expect(screen.getByLabelText("Test suite")).toBeInTheDocument();
      expect(screen.getByLabelText("Situation")).toBeInTheDocument();
      expect(screen.getByLabelText("Criteria")).toBeInTheDocument();
      expect(dialog.textContent).not.toMatch(/with AI|Langy/i);
    });

    /** @scenario "The situation and the criteria grow with what is written in them" */
    it("lets the situation and the criteria grow, and caps them at three times their height", async () => {
      openNew();
      await screen.findByTestId("case-modal");

      // Growing is the browser's job once the field asks for it, so what the
      // dialog owns is the ask and the two heights: the height the field opens
      // at, which a grown field would otherwise shrink under while it is empty,
      // and the height it stops growing at.
      for (const label of ["Situation", "Criteria"]) {
        const field = screen.getByLabelText(label);
        const style = window.getComputedStyle(field);

        expect(field).toHaveAttribute("rows");
        expect(style.resize).toBe("none");

        const opensAt = Number.parseFloat(style.minHeight);
        const stopsAt = Number.parseFloat(style.maxHeight);
        expect(opensAt).toBeGreaterThan(0);
        expect(stopsAt).toBeCloseTo(opensAt * 3, 0);
      }
    });

    /** @scenario "The scenario dialog footer holds the labels, Save and Save and Run" */
    it("holds the labels on the left and the two save buttons on the right", async () => {
      openNew();
      await screen.findByTestId("case-modal");

      expect(screen.getByText("Labels")).toBeInTheDocument();
      expect(screen.getByTestId("case-modal-save")).toHaveTextContent("Save");
      expect(screen.getByTestId("case-modal-save-and-run")).toHaveTextContent(
        "Save & Run",
      );
    });

    /** @scenario "The parameters, the turn limits and the models wait behind chips" */
    it("keeps the parameters, the turn limits and the models behind chips", async () => {
      openNew();
      await screen.findByTestId("case-modal");

      expect(screen.queryByLabelText("Parameters")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Max turns")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Min turns")).not.toBeInTheDocument();
      expect(screen.queryByTestId("case-models-block")).not.toBeInTheDocument();

      const chips = screen.getByTestId("customize-case-chips");
      expect(chips).toHaveTextContent("Customize scenario");
      expect(
        within(chips).getByTestId("customize-chip-case-parameters"),
      ).toHaveTextContent("Add parameters");
      expect(
        within(chips).getByTestId("customize-chip-case-turns"),
      ).toHaveTextContent("Define min and max turns");
      expect(
        within(chips).getByTestId("customize-chip-case-models"),
      ).toHaveTextContent("Override models");
    });

    /** @scenario "A chip opens its block and the block can be removed again" */
    it("opens the turn fields on the chip and takes them away again", async () => {
      const user = userEvent.setup();
      openNew();
      await screen.findByTestId("case-modal");

      await user.click(screen.getByTestId("customize-chip-case-turns"));

      expect(await screen.findByLabelText("Max turns")).toBeVisible();
      expect(screen.getByLabelText("Min turns")).toBeVisible();
      expect(
        screen.queryByTestId("customize-chip-case-turns"),
      ).not.toBeInTheDocument();

      await user.click(
        screen.getByRole("button", { name: "Remove the turn limits" }),
      );

      await waitFor(() =>
        expect(screen.queryByLabelText("Max turns")).not.toBeInTheDocument(),
      );
      expect(
        screen.getByTestId("customize-chip-case-turns"),
      ).toBeInTheDocument();
    });

    /** @scenario "Save and Run saves the scenario and then asks what to run it against" */
    it("saves first, then opens the run dialog for what it saved", async () => {
      const user = userEvent.setup();
      openNew();
      await screen.findByTestId("case-modal");

      await user.type(screen.getByLabelText("Title"), "Angry customer");
      await user.type(screen.getByLabelText("Criteria"), "Keeps a calm tone");
      await user.click(screen.getByTestId("case-modal-save-and-run"));

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Angry customer",
          criteria: ["Keeps a calm tone"],
          testSuiteId: REFUNDS.id,
        }),
      );
      await waitFor(() =>
        expect(screen.getByTestId("run-case-dialog")).toBeInTheDocument(),
      );
    });
  });

  describe("when a stored scenario is edited", () => {
    /** @scenario "Editing a scenario opens the blocks it already uses" */
    it("opens the blocks the stored scenario already carries", async () => {
      mockGetById.mockReturnValue({
        data: storedCase({
          parameters: [{ name: "customer_plan", defaultValue: "free" }],
          judgeModel: "openai/gpt-5-mini",
        }),
        isLoading: false,
        refetch: vi.fn(),
      });
      openDrawerAs({ scenarioId: "case_1" });
      render(
        <>
          <AgentTestingCaseEditor />
          <AgentTestingCaseEditorDrawer />
        </>,
        { wrapper: Wrapper },
      );

      expect(await screen.findByLabelText("Parameters")).toHaveValue(
        "customer_plan=free",
      );
      expect(screen.getByTestId("case-models-block")).toBeInTheDocument();
      // Nothing the scenario does not use is opened: the turns stay on their chip.
      expect(screen.queryByLabelText("Max turns")).not.toBeInTheDocument();
      expect(
        screen.getByTestId("customize-chip-case-turns"),
      ).toBeInTheDocument();
    });

    /** @scenario "Editing a scenario names its version and opens the history" */
    /** @scenario "History opens a popover listing the versions newest first" */
    it("names the version in the header and opens the history beside it", async () => {
      const user = userEvent.setup();
      mockGetById.mockReturnValue({
        data: storedCase(),
        isLoading: false,
        refetch: vi.fn(),
      });
      mockListVersions.mockReturnValue({
        data: {
          versions: [
            {
              version: 4,
              createdAt: new Date().toISOString(),
              changedFields: ["name"],
              author: { name: "Lena Fischer" },
            },
          ],
        },
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
      });
      openDrawerAs({ scenarioId: "case_1" });
      render(
        <>
          <AgentTestingCaseEditor />
          <AgentTestingCaseEditorDrawer />
        </>,
        { wrapper: Wrapper },
      );

      expect(await screen.findByText("Edit scenario")).toBeInTheDocument();
      const history = screen.getByTestId("case-modal-history");
      expect(history).toHaveTextContent("v4 · History");

      await user.click(history);

      // The history reads in place, and the scenario dialog stays open under it.
      expect(
        await screen.findByTestId("scenario-version-history"),
      ).toBeInTheDocument();
      expect(screen.getByTestId("version-row-4")).toBeInTheDocument();
      expect(screen.getByTestId("case-modal")).toBeInTheDocument();
      expect(mockOpenDrawer).not.toHaveBeenCalled();
    });
  });
});

/**
 * @vitest-environment jsdom
 *
 * The Agent Testing suite editor drawer: what tabs it draws, how the Test
 * cases tab reads, and how "Add test cases" files a case into the suite.
 *
 * @see specs/features/agent-testing/suites-rail.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentTestingSuiteEditorDrawer } from "../cases/AgentTestingSuiteEditorDrawer";

const mockOpenDrawer = vi.hoisted(() => vi.fn());
const mockClose = vi.hoisted(() => vi.fn());
const mockMoveMutate = vi.hoisted(() => vi.fn());
const mockGetById = vi.hoisted(() => vi.fn());
const mockScenariosGetAll = vi.hoisted(() => vi.fn());
const mockDrawerParams = vi.hoisted(() => ({
  current: {} as Record<string, string>,
}));
const mockDrawerOpenFor = vi.hoisted(() => ({ current: "" }));

const REFUNDS = { id: "suite_refunds", name: "Refunds" };

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      suites: {
        getById: { invalidate: vi.fn() },
        folders: { getAll: { invalidate: vi.fn() } },
        getAll: { invalidate: vi.fn() },
      },
      scenarios: { getAll: { invalidate: vi.fn() } },
    }),
    suites: {
      getById: { useQuery: mockGetById },
      update: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
      run: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
    scenarios: {
      getAll: { useQuery: mockScenariosGetAll },
      moveToFolder: {
        useMutation: () => ({ mutate: mockMoveMutate, isPending: false }),
      },
    },
    modelProvider: {
      listAllForProjectForFrontend: {
        useQuery: () => ({ data: undefined, isLoading: false }),
      },
      getResolvedDefault: {
        useQuery: () => ({ data: undefined, isLoading: false }),
      },
    },
  },
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    openDrawer: mockOpenDrawer,
    closeDrawer: mockClose,
    drawerOpen: (drawer: string) => drawer === mockDrawerOpenFor.current,
    setFlowCallbacks: vi.fn(),
  }),
  useDrawerParams: () => mockDrawerParams.current,
  getFlowCallbacks: () => undefined,
  setFlowCallbacks: vi.fn(),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj_1", slug: "test-project" },
  }),
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ query: {}, asPath: "", push: vi.fn(), isReady: true }),
}));

vi.mock("~/hooks/useModelProvidersSettings", () => ({
  useModelProvidersSettings: () => ({ hasEnabledProviders: true }),
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

function openEditor() {
  mockDrawerParams.current = { suiteId: REFUNDS.id };
  mockDrawerOpenFor.current = "agentTestingSuiteEditor";
}

describe("the suite editor drawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDrawerParams.current = {};
    mockDrawerOpenFor.current = "";
    mockGetById.mockReturnValue({
      data: {
        id: REFUNDS.id,
        name: REFUNDS.name,
        labels: [],
        simulatorModel: null,
        judgeModel: null,
        repeatCount: 1,
        kind: "folder",
      },
      isLoading: false,
    });
    mockScenariosGetAll.mockReturnValue({
      data: [
        { id: "case_1", name: "Double charge", folderId: REFUNDS.id },
        { id: "case_2", name: "Late refund", folderId: null },
      ],
    });
  });

  afterEach(cleanup);

  /** @scenario "Edit suite opens the suite editor drawer with four tabs" */
  it("draws four tabs: General, Test cases, Simulation models, Execution", () => {
    openEditor();
    render(<AgentTestingSuiteEditorDrawer />, { wrapper: Wrapper });

    expect(screen.getByTestId("suite-editor-tab-general")).toHaveTextContent(
      "General",
    );
    expect(screen.getByTestId("suite-editor-tab-cases")).toHaveTextContent(
      "Test cases",
    );
    expect(screen.getByTestId("suite-editor-tab-models")).toHaveTextContent(
      "Simulation models",
    );
    expect(screen.getByTestId("suite-editor-tab-execution")).toHaveTextContent(
      "Execution",
    );
  });

  /** @scenario "The Test cases tab lists the cases filed under the suite and can add and remove" */
  it("lists the cases filed under the suite and offers add and remove", async () => {
    const user = userEvent.setup();
    openEditor();
    render(<AgentTestingSuiteEditorDrawer />, { wrapper: Wrapper });

    await user.click(screen.getByTestId("suite-editor-tab-cases"));

    expect(
      screen.getByTestId("suite-editor-case-Double charge"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("suite-editor-add-cases")).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Remove Double charge from this test suite",
      }),
    ).toBeInTheDocument();
  });

  /** @scenario "Add test cases opens a picker of cases not currently in the suite" */
  it("opens a picker with the cases NOT currently in the suite", async () => {
    const user = userEvent.setup();
    openEditor();
    render(<AgentTestingSuiteEditorDrawer />, { wrapper: Wrapper });

    await user.click(screen.getByTestId("suite-editor-tab-cases"));
    await user.click(screen.getByTestId("suite-editor-add-cases"));

    expect(
      screen.getByTestId("suite-editor-add-cases-dialog"),
    ).toBeInTheDocument();
    // The already-filed case is not offered again.
    expect(
      screen.queryByTestId("suite-editor-picker-Double charge"),
    ).not.toBeInTheDocument();
    // The unfiled one is.
    const row = screen.getByTestId("suite-editor-picker-Late refund");
    await user.click(row);
    await user.click(screen.getByTestId("suite-editor-add-cases-confirm"));

    expect(mockMoveMutate).toHaveBeenCalledWith({
      projectId: "proj_1",
      scenarioId: "case_2",
      folderId: REFUNDS.id,
    });
  });
});

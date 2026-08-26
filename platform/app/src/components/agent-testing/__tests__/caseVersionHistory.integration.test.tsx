/**
 * @vitest-environment jsdom
 *
 * Scenario history in the interface: the version chip in the editor, the
 * version list with its restore, and the stale-save offer.
 *
 * @see specs/features/agent-testing/case-version-history.feature
 * @see specs/scenarios/scenario-versioning.feature
 * @see specs/scenarios/scenario-version-restore.feature
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
import { ScenarioFormDrawer } from "~/components/scenarios/ScenarioFormDrawer";
import { ScenarioVersionHistoryDrawer } from "../drawers/ScenarioVersionHistoryDrawer";

const mocks = vi.hoisted(() => ({
  mockUpdateMutateAsync: vi.fn(),
  mockCreateMutateAsync: vi.fn(),
  mockGetById: vi.fn(),
  mockGetByIdRefetch: vi.fn(async () => ({})),
  mockListVersions: vi.fn(),
  mockListVersionsRefetch: vi.fn(),
  mockGetVersion: vi.fn(),
  mockRestoreVersion: vi.fn(),
  mockOpenDrawer: vi.fn(),
  mockCloseDrawer: vi.fn(),
  mockParams: {} as Record<string, string | undefined>,
  canManage: true,
  /** The agent this case last ran against, as the editor remembers it. */
  persistedTarget: null as { type: string; id: string } | null,
}));

vi.mock("~/utils/api", () => ({
  api: {
    scenarios: {
      create: {
        useMutation: () => ({
          mutateAsync: mocks.mockCreateMutateAsync,
          isPending: false,
        }),
      },
      update: {
        useMutation: ({
          onSuccess,
          onError,
        }: {
          onSuccess?: (data: unknown) => void;
          onError?: (error: unknown) => void;
        }) => ({
          mutateAsync: vi.fn(async (input: unknown) => {
            try {
              const result = await mocks.mockUpdateMutateAsync(input);
              onSuccess?.(result);
              return result;
            } catch (error) {
              onError?.(error);
              throw error;
            }
          }),
          isPending: false,
        }),
      },
      getById: { useQuery: mocks.mockGetById },
      listVersions: { useQuery: mocks.mockListVersions },
      getVersion: { useQuery: mocks.mockGetVersion },
      restoreVersion: {
        useMutation: ({
          onSuccess,
          onSettled,
        }: {
          onSuccess?: (data: unknown, variables: unknown) => void;
          onSettled?: () => void;
        }) => ({
          mutate: (variables: unknown) => {
            mocks.mockRestoreVersion(variables);
            onSuccess?.({}, variables);
            onSettled?.();
          },
          isPending: false,
          variables: undefined,
        }),
      },
    },
    suites: { folders: { getAll: { useQuery: () => ({ data: [] }) } } },
    agents: { getAll: { useQuery: () => ({ data: [] }) } },
    prompts: {
      getAllPromptsForProject: {
        useQuery: () => ({ data: [], isLoading: false }),
      },
    },
    licenseEnforcement: {
      checkLimit: {
        useQuery: () => ({
          data: { allowed: true, current: 0, max: 100 },
          isLoading: false,
        }),
      },
      reportLimitBlocked: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
    useUtils: () => ({
      scenarios: {
        getAll: { invalidate: vi.fn() },
        getById: { invalidate: vi.fn(), setData: vi.fn() },
        getByIdIncludingArchived: { invalidate: vi.fn() },
        listVersions: { invalidate: vi.fn() },
      },
    }),
  },
}));

vi.mock("~/components/scenarios/SaveAndRunMenu", () => ({
  SaveAndRunMenu: () => null,
}));
vi.mock("~/components/scenarios/ScenarioEditorSidebar", () => ({
  ScenarioEditorSidebar: () => null,
}));
vi.mock("~/components/scenarios/ScenarioRunModelDialog", () => ({
  ScenarioRunModelDialog: () => null,
}));
vi.mock("~/components/agents/AgentTypeSelectorDrawer", () => ({
  AgentTypeSelectorDrawer: () => null,
}));
vi.mock("~/components/prompts/PromptEditorDrawer", () => ({
  PromptEditorDrawer: () => null,
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    openDrawer: mocks.mockOpenDrawer,
    closeDrawer: mocks.mockCloseDrawer,
    drawerOpen: () => true,
    goBack: vi.fn(),
    canGoBack: false,
  }),
  useDrawerParams: () => mocks.mockParams,
  getComplexProps: () => ({}),
  setFlowCallbacks: vi.fn(),
  clearFlowCallbacks: vi.fn(),
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

vi.mock("~/hooks/useRunScenario", () => ({
  useRunScenario: () => ({ runScenario: vi.fn(), isRunning: false }),
}));

vi.mock("~/hooks/useScenarioTarget", () => ({
  useScenarioTarget: () => ({
    target: mocks.persistedTarget,
    setTarget: vi.fn(),
    clearTarget: vi.fn(),
    hasPersistedTarget: !!mocks.persistedTarget,
  }),
}));

vi.mock("~/hooks/useCan", () => ({
  useCan: () => ({
    can: () => mocks.canManage,
    isLoading: false,
    permissions: [],
  }),
}));

vi.mock("~/stores/upgradeModalStore", () => ({
  useUpgradeModalStore: (selector: unknown) => {
    if (typeof selector === "function") {
      return (selector as (state: { open: () => void }) => unknown)({
        open: vi.fn(),
      });
    }
    return { open: vi.fn() };
  },
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

function scenarioAt(version: number) {
  return {
    id: "case_1",
    name: "Angry refund request",
    situation: "A customer demands a refund",
    criteria: ["stays polite"],
    labels: [],
    parameters: null,
    version,
    folderId: null,
    archivedAt: null,
  };
}

function versionEntry(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    authorId: "user_1",
    authorLabel: "user",
    authorName: "Lena Fischer",
    changeDescription: null,
    changedFields: ["name", "criteria"],
    createdAt: new Date("2026-08-20T10:00:00.000Z"),
    isSynthesized: false,
    ...overrides,
  };
}

describe("the version chip in the case editor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.persistedTarget = null;
    mocks.mockParams = {};
    mocks.canManage = true;
    mocks.mockGetById.mockReturnValue({
      data: scenarioAt(4),
      isLoading: false,
      isError: false,
      error: null,
      refetch: mocks.mockGetByIdRefetch,
    });
    mocks.mockUpdateMutateAsync.mockResolvedValue(scenarioAt(5));
  });

  afterEach(cleanup);

  const renderEditor = () =>
    render(
      <ScenarioFormDrawer
        open
        scenarioId="case_1"
        variant="agent-testing"
        onClose={vi.fn()}
      />,
      { wrapper: Wrapper },
    );

  /** @scenario "The editor shows the current version beside the case name" */
  it("shows the current version beside the case name", async () => {
    renderEditor();

    expect(await screen.findByTestId("case-version-4")).toBeInTheDocument();
  });

  /** @scenario "The chip goes up after a save" */
  it("moves the chip up after a save", async () => {
    const user = userEvent.setup();
    const view = renderEditor();
    expect(await screen.findByTestId("case-version-4")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocks.mockUpdateMutateAsync).toHaveBeenCalled());
    // The save carries the version the form loaded, and the fresh read
    // answers with the next one.
    expect(mocks.mockUpdateMutateAsync.mock.calls[0]![0]).toMatchObject({
      expectedVersion: 4,
    });

    mocks.mockGetById.mockReturnValue({
      data: scenarioAt(5),
      isLoading: false,
      isError: false,
      error: null,
      refetch: mocks.mockGetByIdRefetch,
    });
    view.rerender(
      <ChakraProvider value={defaultSystem}>
        <ScenarioFormDrawer
          open
          scenarioId="case_1"
          variant="agent-testing"
          onClose={vi.fn()}
        />
      </ChakraProvider>,
    );

    expect(await screen.findByTestId("case-version-5")).toBeInTheDocument();
  });

  /** @scenario "A save that lost a race says the case changed" */
  it("says the case changed and offers the reload when a save lost the race", async () => {
    const user = userEvent.setup();
    mocks.mockUpdateMutateAsync.mockRejectedValue({
      data: {
        error: {
          code: "scenario_stale_version",
          httpStatus: 409,
          meta: { currentVersion: 6 },
        },
      },
    });
    renderEditor();
    await screen.findByTestId("case-version-4");

    await user.click(screen.getByRole("button", { name: "Save" }));

    const notice = await screen.findByTestId("scenario-stale-version");
    expect(notice).toHaveTextContent(
      "This scenario changed since it was opened",
    );
    expect(notice).toHaveTextContent("version 6");
    // The reload replaces the form, so the offer has to say the edits go.
    expect(notice).toHaveTextContent("Reloading replaces them");
    expect(screen.queryByText(/unknown error/i)).not.toBeInTheDocument();

    await user.click(
      within(notice).getByRole("button", {
        name: "Discard my edits and reload",
      }),
    );
    await waitFor(() => expect(mocks.mockGetByIdRefetch).toHaveBeenCalled());
  });

  it("offers a ghost History control in the editor footer", async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.click(await screen.findByTestId("editor-history"));

    expect(mocks.mockOpenDrawer).toHaveBeenCalledWith(
      "scenarioVersionHistory",
      { urlParams: { scenarioId: "case_1" } },
    );
  });
});

describe("the History drawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.persistedTarget = null;
    mocks.canManage = true;
    mocks.mockParams = { scenarioId: "case_1" };
    mocks.mockListVersions.mockReturnValue({
      data: {
        versions: [
          versionEntry({
            version: 3,
            changedFields: ["situation", "criteria"],
          }),
          versionEntry({ version: 2, changedFields: ["name"] }),
          versionEntry({
            version: 1,
            changedFields: [],
            changeDescription: "Created",
          }),
        ],
      },
      isLoading: false,
      isError: false,
      refetch: mocks.mockListVersionsRefetch,
    });
    mocks.mockGetVersion.mockReturnValue({
      data: {
        version: 2,
        fields: {
          name: "Angry refund request",
          situation: "A calmer, older situation",
          criteria: ["stays polite"],
          labels: [],
          parameters: null,
          simulatorModel: null,
          judgeModel: null,
          maxTurns: null,
          minTurns: null,
        },
        schemaVersion: 1,
      },
      isLoading: false,
    });
  });

  afterEach(cleanup);

  const renderHistory = () =>
    render(<ScenarioVersionHistoryDrawer open />, { wrapper: Wrapper });

  /** @scenario "History opens a popover listing the versions newest first" */
  it("lists the versions newest first", () => {
    renderHistory();

    const drawer = screen.getByTestId("scenario-version-history");
    const rows = within(drawer).getAllByTestId(/^version-row-\d+$/);
    expect(rows.map((row) => row.getAttribute("data-testid"))).toEqual([
      "version-row-3",
      "version-row-2",
      "version-row-1",
    ]);
  });

  /** @scenario "A history entry names the author, the date and the changed fields" */
  it("names the author, the date and the changed fields on an entry", () => {
    renderHistory();

    const row = screen.getByTestId("version-row-3");
    expect(within(row).getByText(/Lena Fischer/)).toBeInTheDocument();
    // One line: the changed fields, then the date of the save.
    expect(
      within(row).getByText(/changed situation, criteria · .+/),
    ).toBeInTheDocument();
  });

  /** @scenario "The version a restore wrote says that it is a restore" */
  it("reads a restored version as a restore, not as a field change", () => {
    mocks.mockListVersions.mockReturnValue({
      data: {
        versions: [
          versionEntry({
            version: 4,
            changedFields: ["name", "criteria"],
            changeDescription: "Restored from v1",
          }),
          versionEntry({ version: 1, changedFields: [] }),
        ],
      },
      isLoading: false,
      isError: false,
      refetch: mocks.mockListVersionsRefetch,
    });
    renderHistory();

    const row = screen.getByTestId("version-row-4");
    expect(within(row).getByText(/Restored from v1 · .+/)).toBeInTheDocument();
    expect(within(row).queryByText(/changed name/)).not.toBeInTheDocument();
  });

  /** @scenario "Choosing a version shows what it held" */
  it("opens a version read-only and keeps the current one marked", async () => {
    const user = userEvent.setup();
    renderHistory();

    await user.click(
      within(screen.getByTestId("version-row-2")).getByText("v2"),
    );

    const content = await screen.findByTestId("version-content-2");
    expect(
      within(content).getByText("A calmer, older situation"),
    ).toBeInTheDocument();
    // No field to edit: the content is read-only text.
    expect(within(content).queryByRole("textbox")).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId("version-row-3")).getByText("Current"),
    ).toBeInTheDocument();
  });

  /** @scenario "A case that never had a save shows one Created entry" */
  it("shows one Created entry for a case saved before history existed", () => {
    mocks.mockListVersions.mockReturnValue({
      data: {
        versions: [
          versionEntry({
            version: 1,
            authorId: null,
            authorLabel: null,
            authorName: null,
            changeDescription: "Created",
            changedFields: [],
            isSynthesized: true,
          }),
        ],
      },
      isLoading: false,
      isError: false,
      refetch: mocks.mockListVersionsRefetch,
    });
    renderHistory();

    const rows = screen.getAllByTestId(/^version-row-\d+$/);
    expect(rows).toHaveLength(1);
    expect(within(rows[0]!).getByText("v1")).toBeInTheDocument();
    expect(within(rows[0]!).getByText(/Created/)).toBeInTheDocument();
  });

  // --- Restore ---

  /** @scenario "Restore writes a new version and lists the new one on top" */
  it("restores an old version as a new one and keeps every version listed", async () => {
    const user = userEvent.setup();
    mocks.mockListVersions.mockReturnValue({
      data: {
        versions: [versionEntry({ version: 5 }), versionEntry({ version: 2 })],
      },
      isLoading: false,
      isError: false,
      refetch: mocks.mockListVersionsRefetch,
    });
    const view = renderHistory();

    await user.click(screen.getByTestId("restore-2"));
    await user.click(screen.getByTestId("confirm-restore-2"));

    expect(mocks.mockRestoreVersion).toHaveBeenCalledWith({
      projectId: "proj_1",
      scenarioId: "case_1",
      version: 2,
    });

    // The restore wrote the old content forward: version 6 heads the list and
    // version 5 is still there.
    mocks.mockListVersions.mockReturnValue({
      data: {
        versions: [
          versionEntry({
            version: 6,
            changedFields: [],
            changeDescription: "Restored from version 2",
          }),
          versionEntry({ version: 5 }),
          versionEntry({ version: 2 }),
        ],
      },
      isLoading: false,
      isError: false,
      refetch: mocks.mockListVersionsRefetch,
    });
    view.rerender(
      <ChakraProvider value={defaultSystem}>
        <ScenarioVersionHistoryDrawer open />
      </ChakraProvider>,
    );

    const rows = screen.getAllByTestId(/^version-row-\d+$/);
    expect(rows[0]!.getAttribute("data-testid")).toBe("version-row-6");
    expect(screen.getByTestId("version-row-5")).toBeInTheDocument();
  });

  /** @scenario "Restore asks for confirmation before it writes" */
  it("asks for confirmation naming the version, and writes nothing on cancel", async () => {
    const user = userEvent.setup();
    renderHistory();

    await user.click(screen.getByTestId("restore-2"));

    const confirm = screen.getByTestId("confirm-restore-2");
    expect(confirm).toHaveTextContent("Restore v2");
    expect(mocks.mockRestoreVersion).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mocks.mockRestoreVersion).not.toHaveBeenCalled();
    expect(screen.queryByTestId("confirm-restore-2")).not.toBeInTheDocument();
  });

  /** @scenario "A viewer sees history but no Restore control" */
  it("lists the versions without a Restore control for a viewer", () => {
    mocks.canManage = false;
    renderHistory();

    expect(screen.getByTestId("version-row-3")).toBeInTheDocument();
    expect(screen.getByTestId("version-row-2")).toBeInTheDocument();
    expect(screen.queryByTestId("restore-2")).not.toBeInTheDocument();
    expect(screen.queryByText("Restore")).not.toBeInTheDocument();
  });

  // --- Failure paths ---

  /** @scenario "A history that cannot load says so and offers to retry" */
  it("says the history could not be loaded and offers to try again", async () => {
    const user = userEvent.setup();
    mocks.mockListVersions.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: mocks.mockListVersionsRefetch,
    });
    renderHistory();

    expect(screen.getByTestId("version-history-error")).toHaveTextContent(
      "The history could not be loaded.",
    );
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(mocks.mockListVersionsRefetch).toHaveBeenCalled();
  });
});

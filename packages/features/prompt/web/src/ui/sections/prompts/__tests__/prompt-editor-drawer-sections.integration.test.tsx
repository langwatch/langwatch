/**
 * @vitest-environment jsdom
 *
 * The two editing sections of the prompt editor, as the person shaping a
 * prompt meets them: the inputs they can add to, and the outputs below.
 *
 * Rendered headless — the drawer chrome is not what these are about — with
 * only the host seams stubbed, so the composition under test is the real one.
 *
 * @see specs/prompts/prompt-editor-outputs.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@langwatch/ui-host/use-drawer", () => ({
  useDrawer: () => ({
    closeDrawer: vi.fn(),
    openDrawer: vi.fn(),
    canGoBack: false,
    goBack: vi.fn(),
  }),
  useDrawerParams: () => ({}),
  getComplexProps: () => ({}),
  getFlowCallbacks: () => void 0,
}));

vi.mock("@langwatch/ui-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-1", defaultModel: "openai/gpt-5-mini" },
    organization: { id: "organization-1" },
    team: { id: "team-1" },
  }),
}));

vi.mock("@langwatch/ui-host/upgrade-modal-store", () => ({
  useUpgradeModalStore: (selector?: (state: { open: () => void }) => unknown) => {
    const state = { open: vi.fn() };
    return typeof selector === "function" ? selector(state) : state;
  },
}));

vi.mock("@langwatch/model-provider-web/surfaces/model-provider-settings", () => ({
  useModelProvidersSettings: () => ({
    modelMetadata: {
      "openai/gpt-5-mini": {
        name: "gpt-5-mini",
        contextLength: 128000,
        maxCompletionTokens: 16384,
      },
    },
    isLoading: false,
  }),
}));

vi.mock("@langwatch/workflow-web/surfaces/studio-scope", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-1", slug: "demo", name: "Demo" },
    organization: { id: "organization-1" },
    team: { id: "team-1" },
    projectId: "project-1",
    modelProviders: {},
    isResolved: true,
    isLoading: false,
    isRefetching: false,
  }),
}));

vi.mock("@langwatch/workflow-web/surfaces/studio-drawer-footer", () => ({
  useRegisterDrawerFooter: () => void 0,
}));

vi.mock("../../../../behavior/prompts/use-latest-prompt-version", () => ({
  useLatestPromptVersion: () => ({ data: void 0, isLoading: false }),
}));

const idleQuery = { data: void 0, isLoading: false, error: null, refetch: vi.fn() };
const idleMutation = () => ({ mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false });

vi.mock("@langwatch/workflow-web/surfaces/workflow-api", () => ({
  api: {
    useUtils: () => ({ prompts: { getByIdOrHandle: { invalidate: vi.fn() } } }),
    modelProvider: {
      getResolvedDefault: { useQuery: () => idleQuery },
      getAllForProject: { useQuery: () => idleQuery },
      listAllForProjectForFrontend: { useQuery: () => idleQuery },
    },
    llmModelCost: { tryGetModelLimits: { useQuery: () => idleQuery } },
    prompts: {
      getByIdOrHandle: { useQuery: () => idleQuery },
      create: { useMutation: idleMutation },
      update: { useMutation: idleMutation },
      updateHandle: { useMutation: idleMutation },
    },
  },
}));

const { PromptEditorDrawer } = await import("../prompt-editor-drawer");

function renderEditor() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <PromptEditorDrawer headless />
    </ChakraProvider>,
  );
}

afterEach(() => {
  cleanup();
});

describe("given a prompt open in the prompt editor", () => {
  describe("when the editor renders", () => {
    /** @scenario "Outputs section renders below the inputs section" */
    it("puts the Outputs section below the inputs, where the response is shaped", () => {
      renderEditor();

      const variables = screen.getByText("Variables");
      const outputs = screen.getByText("Outputs");

      expect(
        variables.compareDocumentPosition(outputs) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    /** @scenario "Inputs section shows the Add button in the prompt editor" */
    it("offers an Add button on the inputs section, so adding is one click away", () => {
      renderEditor();

      expect(screen.getByTestId("add-variable-button")).toBeTruthy();
    });
  });

  describe("when an input is added through the Add button", () => {
    /** @scenario "Input added via the Add button is usable in the template" */
    it("lands a typed variable in the section, ready to name in the template", async () => {
      const user = userEvent.setup();
      renderEditor();

      await user.click(screen.getByTestId("add-variable-button"));
      await user.click(screen.getByRole("menuitem", { name: /Text/ }));

      // The default "input" variable already exists, so the new one dedupes
      // to input_1 and shows as a variable row.
      expect(await screen.findByText("input_1")).toBeTruthy();
    });
  });
});

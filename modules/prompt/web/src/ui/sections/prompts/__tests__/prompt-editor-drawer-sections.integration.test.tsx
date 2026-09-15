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
import type { ComponentProps } from "react";
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

// The model control the sticky header carries, stubbed to something nameable:
// what the header scenario is about is where the control sits, not which models
// the project has configured.
vi.mock("../../../elements/prompts/forms/fields/model-select-field-mini.tsx", () => ({
  ModelSelectFieldMini: () => <button data-testid="model-select">gpt-5-mini</button>,
}));

vi.mock("../../../../behavior/prompts/use-latest-prompt-version.ts", () => ({
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

const { PromptEditorDrawer } = await import("../prompt-editor-drawer.tsx");

function renderEditor(props: Partial<ComponentProps<typeof PromptEditorDrawer>> = {}) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <PromptEditorDrawer headless {...props} />
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

    /**
     * @scenario "The model selector header stays opaque above scrolling messages"
     *
     * The model selector rides in a sticky header over the messages. Without a
     * solid background the messages scrolled through it and the two read as one
     * smear. jsdom resolves no custom property, so what is pinned here is that
     * the header is sticky, holds the selector, and carries a background token
     * at all — deleting the prop leaves the rule unset and fails this.
     */
    it("pins the model selector in a sticky header that paints its own background", () => {
      renderEditor();

      const header = screen.getByTestId("prompt-editor-sticky-header");

      expect(header).toContainElement(screen.getByTestId("model-select"));
      const style = getComputedStyle(header);
      expect(style.position).toBe("sticky");
      expect((style.background || "").trim()).toMatch(/var\(--chakra-colors-/);
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

describe("given a studio node whose library prompt is not in this project", () => {
  describe("when the prompt drawer is opened for the node", () => {
    /** @scenario "A node whose library prompt is missing shows its inline config" */
    it("opens on the node's own inline config rather than an empty new prompt", async () => {
      // The prompt read answers nothing for this id — the imported-workflow
      // case. Without the fallback the author met a blank form and the node's
      // real prompt was one save away from being overwritten with it.
      renderEditor({
        promptId: "missing-prompt",
        inlineConfigFallback: {
          llm: { model: "openai/gpt-5-mini" },
          messages: [{ role: "system", content: "INLINE-FALLBACK-CONTENT" }],
          inputs: [{ identifier: "question", type: "str" }],
          outputs: [{ identifier: "answer", type: "str" }],
        },
      });

      expect(await screen.findByDisplayValue("INLINE-FALLBACK-CONTENT")).toBeTruthy();
      expect(await screen.findByText("question")).toBeTruthy();
      expect(await screen.findByText("answer")).toBeTruthy();
    });
  });
});

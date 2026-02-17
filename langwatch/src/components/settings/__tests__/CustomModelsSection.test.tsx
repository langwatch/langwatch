/**
 * @vitest-environment jsdom
 *
 * Integration tests for the Custom Models section in the model provider drawer.
 *
 * Covers the @integration scenarios from specs/model-providers/custom-models-management.feature:
 * - Custom Models section appears in provider drawer (empty state)
 * - Add button shows options for model types
 * - Adding a model through the dialog adds it to the table
 * - Removing a custom model from the table
 * - See all models link opens read-only registry modal
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  UseModelProviderFormActions,
  UseModelProviderFormState,
} from "../../../hooks/useModelProviderForm";
import type { CustomModelEntry } from "../../../server/modelProviders/customModel.schema";
import type { MaybeStoredModelProvider } from "../../../server/modelProviders/registry";
import { CustomModelInputSection } from "../ModelProviderCustomModelInput";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

function buildState(
  overrides: Partial<UseModelProviderFormState> = {},
): UseModelProviderFormState {
  return {
    useApiGateway: false,
    customKeys: {},
    displayKeys: {},
    initialKeys: {},
    extraHeaders: [],
    customModels: [],
    customEmbeddingsModels: [],
    useAsDefaultProvider: false,
    projectDefaultModel: null,
    projectTopicClusteringModel: null,
    projectEmbeddingsModel: null,
    isSaving: false,
    errors: {},
    ...overrides,
  };
}

function buildActions(
  overrides: Partial<UseModelProviderFormActions> = {},
): UseModelProviderFormActions {
  return {
    setEnabled: vi.fn(),
    setUseApiGateway: vi.fn(),
    setCustomKey: vi.fn(),
    addExtraHeader: vi.fn(),
    removeExtraHeader: vi.fn(),
    toggleExtraHeaderConcealed: vi.fn(),
    setExtraHeaderKey: vi.fn(),
    setExtraHeaderValue: vi.fn(),
    addCustomModel: vi.fn(),
    removeCustomModel: vi.fn(),
    setCustomModels: vi.fn(),
    addCustomEmbeddingsModel: vi.fn(),
    removeCustomEmbeddingsModel: vi.fn(),
    setUseAsDefaultProvider: vi.fn(),
    setProjectDefaultModel: vi.fn(),
    setProjectTopicClusteringModel: vi.fn(),
    setProjectEmbeddingsModel: vi.fn(),
    setManaged: vi.fn(),
    submit: vi.fn(),
    ...overrides,
  };
}

const defaultProvider: MaybeStoredModelProvider = {
  provider: "openai",
  enabled: true,
  customKeys: null,
  models: null,
  embeddingsModels: null,
  disabledByDefault: false,
  deploymentMapping: null,
  extraHeaders: [],
};

describe("CustomModelInputSection", () => {
  afterEach(() => {
    cleanup();
  });

  describe("when no custom models exist", () => {
    it("renders the empty state message", () => {
      const state = buildState();
      const actions = buildActions();

      render(
        <CustomModelInputSection
          state={state}
          actions={actions}
          provider={defaultProvider}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("No custom models added")).toBeTruthy();
    });

    it("renders the Custom Models label", () => {
      const state = buildState();
      const actions = buildActions();

      render(
        <CustomModelInputSection
          state={state}
          actions={actions}
          provider={defaultProvider}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("Custom Models")).toBeTruthy();
    });

    it("renders the Add button", () => {
      const state = buildState();
      const actions = buildActions();

      render(
        <CustomModelInputSection
          state={state}
          actions={actions}
          provider={defaultProvider}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByRole("button", { name: /add/i })).toBeTruthy();
    });
  });

  describe("when custom models exist", () => {
    const chatModel: CustomModelEntry = {
      modelId: "gpt-5-custom",
      displayName: "GPT-5 Custom",
      mode: "chat",
    };

    const embeddingModel: CustomModelEntry = {
      modelId: "embed-custom",
      displayName: "Custom Embedding",
      mode: "embedding",
    };

    it("renders a table with model rows", () => {
      const state = buildState({
        customModels: [chatModel],
        customEmbeddingsModels: [embeddingModel],
      });
      const actions = buildActions();

      render(
        <CustomModelInputSection
          state={state}
          actions={actions}
          provider={defaultProvider}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("gpt-5-custom")).toBeTruthy();
      expect(screen.getByText("GPT-5 Custom")).toBeTruthy();
      expect(screen.getByText("Chat")).toBeTruthy();
      expect(screen.getByText("embed-custom")).toBeTruthy();
      expect(screen.getByText("Custom Embedding")).toBeTruthy();
      expect(screen.getByText("Embedding")).toBeTruthy();
    });

    it("does not show the empty state message", () => {
      const state = buildState({
        customModels: [chatModel],
      });
      const actions = buildActions();

      render(
        <CustomModelInputSection
          state={state}
          actions={actions}
          provider={defaultProvider}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.queryByText("No custom models added")).toBeNull();
    });
  });

  describe("when clicking the Add button", () => {
    it("shows menu with Add model and Add embeddings model options", async () => {
      const user = userEvent.setup();
      const state = buildState();
      const actions = buildActions();

      render(
        <CustomModelInputSection
          state={state}
          actions={actions}
          provider={defaultProvider}
        />,
        { wrapper: Wrapper },
      );

      await user.click(screen.getByRole("button", { name: /add/i }));

      await waitFor(() => {
        expect(screen.getByText("Add model")).toBeTruthy();
        expect(screen.getByText("Add embeddings model")).toBeTruthy();
      });
    });
  });

  describe("when opening Add model dialog and submitting", () => {
    it("calls addCustomModel with the filled entry", async () => {
      const user = userEvent.setup();
      const addCustomModel = vi.fn();
      const state = buildState();
      const actions = buildActions({ addCustomModel });

      render(
        <CustomModelInputSection
          state={state}
          actions={actions}
          provider={defaultProvider}
        />,
        { wrapper: Wrapper },
      );

      // Open menu
      await user.click(screen.getByRole("button", { name: /add/i }));
      await waitFor(() => {
        expect(screen.getByText("Add model")).toBeTruthy();
      });

      // Click "Add model" menu item
      await user.click(screen.getByText("Add model"));

      // Wait for dialog to appear
      await waitFor(() => {
        expect(screen.getByText("Add Model")).toBeTruthy();
      });

      // Fill form
      const modelIdInput = screen.getByLabelText("Model ID");
      const displayNameInput = screen.getByLabelText("Display Name");

      await user.type(modelIdInput, "gpt-5-custom");
      // Display name is auto-filled from model ID; clear and type the desired value
      await user.clear(displayNameInput);
      await user.type(displayNameInput, "GPT-5 Custom");

      // Submit
      await user.click(screen.getByRole("button", { name: /create model/i }));

      await waitFor(() => {
        expect(addCustomModel).toHaveBeenCalledWith(
          expect.objectContaining({
            modelId: "gpt-5-custom",
            displayName: "GPT-5 Custom",
            mode: "chat",
          }),
        );
      });
    });
  });

  describe("when opening Add embeddings model dialog and submitting", () => {
    it("calls addCustomEmbeddingsModel with the filled entry", async () => {
      const user = userEvent.setup();
      const addCustomEmbeddingsModel = vi.fn();
      const state = buildState();
      const actions = buildActions({ addCustomEmbeddingsModel });

      render(
        <CustomModelInputSection
          state={state}
          actions={actions}
          provider={defaultProvider}
        />,
        { wrapper: Wrapper },
      );

      // Open menu
      await user.click(screen.getByRole("button", { name: /add/i }));
      await waitFor(() => {
        expect(screen.getByText("Add embeddings model")).toBeTruthy();
      });

      // Click "Add embeddings model"
      await user.click(screen.getByText("Add embeddings model"));

      // Wait for dialog
      await waitFor(() => {
        expect(screen.getByText("Add Embeddings Model")).toBeTruthy();
      });

      // Fill form
      const modelIdInput = screen.getByLabelText("Model ID");
      const displayNameInput = screen.getByLabelText("Display Name");

      await user.type(modelIdInput, "embed-custom");
      await user.type(displayNameInput, "Custom Embedding");

      // Submit
      await user.click(screen.getByRole("button", { name: /create model/i }));

      await waitFor(() => {
        expect(addCustomEmbeddingsModel).toHaveBeenCalledWith(
          expect.objectContaining({
            modelId: "embed-custom",
            displayName: "Custom Embedding",
            mode: "embedding",
          }),
        );
      });
    });
  });

  describe("when deleting a custom model", () => {
    it("calls removeCustomModel for chat models", async () => {
      const user = userEvent.setup();
      const removeCustomModel = vi.fn();
      const chatModel: CustomModelEntry = {
        modelId: "gpt-5-custom",
        displayName: "GPT-5 Custom",
        mode: "chat",
      };
      const state = buildState({ customModels: [chatModel] });
      const actions = buildActions({ removeCustomModel });

      render(
        <CustomModelInputSection
          state={state}
          actions={actions}
          provider={defaultProvider}
        />,
        { wrapper: Wrapper },
      );

      const deleteButton = screen.getByRole("button", {
        name: /delete gpt-5-custom/i,
      });
      await user.click(deleteButton);

      expect(removeCustomModel).toHaveBeenCalledWith("gpt-5-custom");
    });

    it("calls removeCustomEmbeddingsModel for embedding models", async () => {
      const user = userEvent.setup();
      const removeCustomEmbeddingsModel = vi.fn();
      const embeddingModel: CustomModelEntry = {
        modelId: "embed-custom",
        displayName: "Custom Embedding",
        mode: "embedding",
      };
      const state = buildState({
        customEmbeddingsModels: [embeddingModel],
      });
      const actions = buildActions({ removeCustomEmbeddingsModel });

      render(
        <CustomModelInputSection
          state={state}
          actions={actions}
          provider={defaultProvider}
        />,
        { wrapper: Wrapper },
      );

      const deleteButton = screen.getByRole("button", {
        name: /delete embed-custom/i,
      });
      await user.click(deleteButton);

      expect(removeCustomEmbeddingsModel).toHaveBeenCalledWith("embed-custom");
    });
  });

  describe("when clicking See all models", () => {
    it("opens the registry models modal", async () => {
      const user = userEvent.setup();
      const state = buildState();
      const actions = buildActions();

      render(
        <CustomModelInputSection
          state={state}
          actions={actions}
          provider={defaultProvider}
        />,
        { wrapper: Wrapper },
      );

      await user.click(screen.getByText("See all models"));

      await waitFor(() => {
        expect(screen.getByText("Registry Models")).toBeTruthy();
      });
    });
  });
});

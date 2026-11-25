/**
 * @vitest-environment jsdom
 * "See all models" on a custom provider lists the provider's own models.
 * @see specs/model-providers/custom-provider-model-import.feature
 */
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithModelProviderHost } from "../../../testing.tsx";
import { CustomModelInputSection } from "../model-provider-custom-model-input.tsx";

const state = {
  customModels: [{ modelId: "model-a", displayName: "Model A", mode: "chat" as const }],
  customEmbeddingsModels: [
    { modelId: "embed-a", displayName: "Embed A", mode: "embedding" as const },
  ],
};

const actions = {
  addCustomModel: vi.fn(),
  removeCustomModel: vi.fn(),
  addCustomEmbeddingsModel: vi.fn(),
  removeCustomEmbeddingsModel: vi.fn(),
};

const provider = { provider: "custom" };

describe("CustomModelInputSection", () => {
  afterEach(() => cleanup());

  describe("when See all models is clicked on a custom provider", () => {
    /** @scenario See all models lists a custom provider's own models */
    it("lists the provider's own models instead of the catalogue", async () => {
      renderWithModelProviderHost(
        <CustomModelInputSection state={state} actions={actions} provider={provider} />,
      );

      await userEvent.setup().click(screen.getByText("See all models"));

      await waitFor(() => {
        expect(screen.getByText("Provider models")).toBeTruthy();
      });
      expect(screen.queryByText("No models found")).toBeNull();
      expect(screen.getAllByText("Model A").length).toBeGreaterThan(1);
      expect(screen.getAllByText("Embed A").length).toBeGreaterThan(1);
    });
  });
});

/**
 * @vitest-environment jsdom
 *
 * `LLMModelDisplay` renders a model's label outside any picker context —
 * e.g. a model column in a list — specs/model-providers/custom-model-
 * display-name.feature, "Model labels outside pickers show the display
 * name". It reads its label from `useModelSelectionOptions`'s
 * `modelOption.label`, the same hook `ModelSelector` (the picker) shares,
 * so a display name resolved for the picker is resolved here too.
 *
 * Renders the real hook (`useModelSelectionOptions`, not mocked) against a
 * mocked studio-host boundary — the only two seams `LLMModelDisplay` and
 * `ModelSelector` both cross to reach a project's configured providers.
 *
 * @see specs/model-providers/custom-model-display-name.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@langwatch/ui-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "proj-1" } }),
}));

vi.mock("@langwatch/workflow-web/studio-host/api", () => ({
  api: {
    modelProvider: {
      listAllForProjectForFrontend: {
        useQuery: () => ({
          data: [
            {
              provider: "custom",
              enabled: true,
              customModels: [
                {
                  modelId: "gpt-5.1",
                  displayName: "Ada Prod Model",
                  mode: "chat",
                },
              ],
              customEmbeddingsModels: null,
            },
          ],
          isLoading: false,
        }),
      },
    },
  },
}));

import { LLMModelDisplay } from "../llm-model-display";

afterEach(() => cleanup());

function renderDisplay(model: string) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <LLMModelDisplay model={model} />
    </ChakraProvider>,
  );
}

describe("<LLMModelDisplay/>", () => {
  describe("given a surface that displays a renamed custom model without offering a choice", () => {
    /** @scenario Model labels outside pickers show the display name */
    it("reads the configured display name", () => {
      renderDisplay("custom/gpt-5.1");

      expect(screen.getByText("Ada Prod Model")).toBeInTheDocument();
    });

    it("does not read the raw model id", () => {
      renderDisplay("custom/gpt-5.1");

      expect(screen.queryByText("gpt-5.1")).not.toBeInTheDocument();
    });
  });
});

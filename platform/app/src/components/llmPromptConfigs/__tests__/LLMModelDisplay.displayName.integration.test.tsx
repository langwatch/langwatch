/**
 * @vitest-environment jsdom
 *
 * LLMModelDisplay renders a model's label outside any picker context —
 * e.g. the model column of the prompts list (src/prompts/PromptsList.tsx)
 * — specs/model-providers/custom-model-display-name.feature, "Model
 * labels outside pickers show the display name". It reads its label
 * from `useModelSelectionOptions`'s `modelOption.label`, which issue
 * #5759 rebuilds from the raw model id instead of a configured custom
 * display name.
 *
 * Renders the real hook (`useModelSelectionOptions`, not mocked) against
 * a mocked tRPC boundary, unlike the existing LLMModelDisplay.test.tsx
 * (which mocks the hook itself away and so can't exercise this bug).
 *
 * @see specs/model-providers/custom-model-display-name.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "proj-1" } }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    modelProvider: {
      listAllForProjectForFrontend: {
        useQuery: () => ({
          data: {
            providers: [
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
          },
          isLoading: false,
        }),
      },
    },
  },
}));

import { LLMModelDisplay } from "../LLMModelDisplay";

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

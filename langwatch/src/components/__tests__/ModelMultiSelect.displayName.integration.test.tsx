/**
 * @vitest-environment jsdom
 *
 * ModelMultiSelect shares `useModelSelectionOptions` with every other
 * model picker in the app (ModelSelector, LLMModelDisplay, ...) —
 * specs/model-providers/custom-model-display-name.feature, "Shared
 * model pickers show the configured display name". Issue #5759: the
 * hook's `selectOptions` mapping rebuilds each item's `label` from the
 * raw model id via `value.split("/").slice(1).join("/")` and never
 * reads the provider's configured custom-model display name
 * (src/components/ModelSelector.tsx, `useModelSelectionOptions`).
 *
 * Renders the real hook against a mocked tRPC boundary (only
 * `api.modelProvider.listAllForProjectForFrontend` and
 * `useOrganizationTeamProject` are mocked) — no dropdown/portal
 * involved, ModelMultiSelect always renders its full option list.
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

import { ModelMultiSelect } from "../ModelMultiSelect";

afterEach(() => cleanup());

function renderPicker() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <ModelMultiSelect value={[]} onChange={() => undefined} />
    </ChakraProvider>,
  );
}

describe("<ModelMultiSelect/>", () => {
  describe("given a custom model with a configured display name", () => {
    describe("when the picker lists its options", () => {
      /** @scenario Shared model pickers show the configured display name */
      it("lists the custom model by its display name", () => {
        renderPicker();

        expect(screen.getByText("Ada Prod Model")).toBeInTheDocument();
      });

      it("does not list the custom model by its raw model id", () => {
        renderPicker();

        expect(screen.queryByText("gpt-5.1")).not.toBeInTheDocument();
      });
    });
  });
});

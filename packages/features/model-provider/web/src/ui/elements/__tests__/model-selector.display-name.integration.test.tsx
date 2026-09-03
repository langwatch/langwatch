/**
 * @vitest-environment jsdom
 *
 * Issue #5837: the owner-reported production repro named TWO surfaces
 * rendering a raw model id instead of the configured Display Name — the
 * Default Models editor (covered in
 * default-model-override-drawer.display-name.integration.test.tsx) and "the
 * prompt-config selector (`ModelSelector`)" (the issue's own words).
 * `ModelSelector` is the picker `LLMConfigField` and the prompt "Model"
 * field render — it shares `useModelSelectionOptions` with every other
 * picker (specs/model-providers/custom-model-display-name.feature,
 * "Shared model pickers show the configured display name").
 *
 * The resolver itself (`buildCustomModelDisplayNames` /
 * `modelDisplayLabel`) is unit-tested elsewhere in this package — this
 * file pins the WIRING for the exact reported repro data shape (an azure
 * custom model), not the resolution logic.
 *
 * Renders the real `ModelSelector` against a mocked studio-host boundary.
 *
 * Query strategy: `ModelSelector` renders through the design-system
 * `Select`, so `Select.HiddenSelect` mirrors every item as a native
 * `<option>` sibling. Queries are scoped to the listbox (mounted in the
 * DOM regardless of open state) to avoid matching that hidden mirror.
 *
 * @see specs/model-providers/custom-model-display-name-resolution.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@langwatch/workflow-web/studio-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "proj-1" } }),
}));

vi.mock("@langwatch/workflow-web/studio-host/api", () => ({
  api: {
    modelProvider: {
      listAllForProjectForFrontend: {
        useQuery: () => ({
          data: [
            {
              provider: "azure",
              enabled: true,
              customModels: [
                {
                  modelId: "gpt-5.1",
                  displayName: "Marketing GPT-5.1",
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

import { ModelSelector } from "../model-selector";

afterEach(() => cleanup());

function renderSelector() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <ModelSelector model="" options={[]} onChange={() => undefined} />
    </ChakraProvider>,
  );
}

function listbox() {
  return screen.getByRole("listbox", { hidden: true });
}

describe("<ModelSelector/>", () => {
  describe("given the reported production repro: an azure custom model with a configured display name", () => {
    describe("when the prompt configuration model selector lists its options", () => {
      /** @scenario The reported production surface shows the configured display name */
      it("lists the azure custom model by its configured display name", () => {
        renderSelector();

        expect(
          within(listbox()).getByText("Marketing GPT-5.1"),
        ).toBeInTheDocument();
      });

      it("does not list the azure custom model by its raw model id", () => {
        renderSelector();

        expect(
          within(listbox()).queryByText("gpt-5.1"),
        ).not.toBeInTheDocument();
      });
    });
  });
});

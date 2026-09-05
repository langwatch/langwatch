/**
 * @vitest-environment jsdom
 * @see specs/model-providers/custom-model-display-name-resolution.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
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
      /** @scenario Shared model pickers show the configured display name */
      it("lists the azure custom model by its configured display name", () => {
        renderSelector();

        expect(within(listbox()).getByText("Marketing GPT-5.1")).toBeInTheDocument();
      });

      it("does not list the azure custom model by its raw model id", () => {
        renderSelector();

        expect(within(listbox()).queryByText("gpt-5.1")).not.toBeInTheDocument();
      });
    });
  });
});

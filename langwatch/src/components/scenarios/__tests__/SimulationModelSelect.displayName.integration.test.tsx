/**
 * @vitest-environment jsdom
 *
 * SimulationModelSelect is the model picker for the scenario
 * user-simulator / judge roles — specs/model-providers/custom-model-display-name.feature,
 * "Scenario model picker shows the configured display name". It wraps
 * ProviderModelSelector but builds `options` itself from the project's
 * providers and (issue #5759) never computes or forwards a
 * `displayNames` map, so the dropdown item falls back to
 * ProviderModelSelector's raw-id label.
 *
 * @see specs/model-providers/custom-model-display-name.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
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
              },
            ],
          },
          isLoading: false,
        }),
      },
      getResolvedDefault: {
        useQuery: () => ({ data: undefined }),
      },
    },
  },
}));

import { SimulationModelSelect } from "../SimulationModelSelect";

afterEach(() => cleanup());

function renderPicker() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <SimulationModelSelect
        label="User simulator"
        value={null}
        onChange={() => undefined}
        featureKey="scenarios.user_simulator"
      />
    </ChakraProvider>,
  );
}

describe("<SimulationModelSelect/>", () => {
  describe("given a custom model with a configured display name", () => {
    describe("when the dropdown lists its options", () => {
      /** @scenario Scenario model picker shows the configured display name */
      it("lists the custom model by its display name", () => {
        renderPicker();

        const listbox = screen.getByRole("listbox", { hidden: true });
        expect(within(listbox).getByText("Ada Prod Model")).toBeInTheDocument();
      });

      it("does not list the custom model by its raw model id", () => {
        renderPicker();

        const listbox = screen.getByRole("listbox", { hidden: true });
        expect(within(listbox).queryByText("gpt-5.1")).not.toBeInTheDocument();
      });
    });
  });
});

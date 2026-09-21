/**
 * @vitest-environment jsdom
 *
 * The composer's picker against the real `useModelSelectionOptions` hook and a
 * mocked tRPC boundary: a provider row stored at ORGANIZATION scope, and no
 * row for the project itself. The project's provider list carries the
 * organization row (ADR-021), so the picker must offer its models.
 *
 * @see specs/langy/langy-model-selection.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
                provider: "anthropic",
                enabled: true,
                customModels: null,
                customEmbeddingsModels: null,
                scopes: [{ scopeType: "ORGANIZATION", scopeId: "org-1" }],
                scopeType: "ORGANIZATION",
                scopeId: "org-1",
              },
            ],
          },
          isLoading: false,
        }),
      },
    },
  },
}));

import { LangyModelPill } from "../components/LangyModelPill";

const OPTIONS = [
  "anthropic/claude-sonnet-4-5",
  "anthropic/claude-haiku-4-5",
  "openai/gpt-5-mini",
];

afterEach(() => cleanup());

function renderPill() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <LangyModelPill
        model="anthropic/claude-sonnet-4-5"
        options={OPTIONS}
        onChange={() => undefined}
      />
    </ChakraProvider>,
  );
}

describe("given the project's only model provider is connected at the organization", () => {
  describe("when the composer's model picker opens", () => {
    /** @scenario "A provider configured on the organization enables its models in the picker" */
    it("offers that provider's models and none from an unconnected provider", async () => {
      const user = userEvent.setup();
      renderPill();

      await user.click(screen.getByTestId("langy-model-picker"));

      const offered = (await screen.findAllByRole("option")).map((option) =>
        option.textContent?.trim(),
      );
      expect(offered).toContain("claude-sonnet-4-5");
      expect(offered).toContain("claude-haiku-4-5");
      expect(offered.join(" ")).not.toContain("gpt-5-mini");
    });
  });
});

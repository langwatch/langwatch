/**
 * @vitest-environment jsdom
 * @see specs/model-config/model-selector-ux.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@langwatch/browser-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "proj-1" } }),
}));

vi.mock("../../../behavior/model-provider-api.ts", () => ({
  api: {
    modelProvider: {
      listAllForProjectForFrontend: {
        useQuery: () => ({
          data: [{ provider: "openai", enabled: true, customModels: null }],
          isLoading: false,
        }),
      },
    },
  },
}));

import { ModelSelector } from "../model-selector.tsx";

afterEach(cleanup);

const NO_MATCH = "No models match your search.";

describe("<ModelSelector/>", () => {
  describe("given a project with an OpenAI provider", () => {
    describe("when the search matches no model", () => {
      /** @scenario Says so when no model matches the search */
      it("says no model matches, and stops once the search matches again", () => {
        renderWithDesignSystem(
          <ModelSelector
            model="openai/gpt-5-mini"
            options={["openai/gpt-5-mini", "openai/gpt-4.1"]}
            onChange={() => undefined}
          />,
        );
        const search = screen.getByPlaceholderText("Search models");
        expect(screen.queryByText(NO_MATCH)).not.toBeInTheDocument();

        fireEvent.change(search, { target: { value: "no-such-model" } });
        expect(screen.getByText(NO_MATCH)).toBeInTheDocument();

        fireEvent.change(search, { target: { value: "gpt-4.1" } });
        expect(screen.queryByText(NO_MATCH)).not.toBeInTheDocument();
      });
    });
  });
});

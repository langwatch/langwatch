/**
 * @vitest-environment jsdom
 * @see modules/instant-eval/specs/instant-eval-judge-model.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@langwatch/browser-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "proj-1" } }),
}));

// The project has no enabled model provider.
vi.mock("../../../behavior/model-provider-api.ts", () => ({
  api: {
    modelProvider: {
      listAllForProjectForFrontend: { useQuery: () => ({ data: [], isLoading: false }) },
    },
  },
}));

import { LLMModelDisplay } from "../llm-model-display.tsx";
import { ModelSelector } from "../model-selector.tsx";

const BUILT_IN = { value: "langwatch/instant-evals", label: "Instant Evals" };

afterEach(() => cleanup());

describe("<ModelSelector/>", () => {
  describe("given a project with no model provider", () => {
    describe("when the picker is handed a built-in model", () => {
      it("lists the built-in model instead of the empty state", () => {
        renderWithDesignSystem(
          <ModelSelector
            model=""
            options={["openai/gpt-5-mini"]}
            onChange={() => undefined}
            builtInModels={[BUILT_IN]}
          />,
        );

        const listbox = screen.getByRole("listbox", { hidden: true });
        expect(within(listbox).getByText("Instant Evals")).toBeInTheDocument();
        expect(screen.queryByTestId("no-models-configured-callout")).not.toBeInTheDocument();
      });
    });

    describe("when the picker is handed no built-in model", () => {
      it("keeps the empty state", () => {
        renderWithDesignSystem(
          <ModelSelector model="" options={["openai/gpt-5-mini"]} onChange={() => undefined} />,
        );

        expect(screen.getByTestId("no-models-configured-callout")).toBeInTheDocument();
      });
    });
  });
});

describe("<LLMModelDisplay/>", () => {
  describe("given a chosen built-in model", () => {
    it("shows its label and asks for no update", async () => {
      renderWithDesignSystem(
        <LLMModelDisplay model="langwatch/instant-evals" builtInModels={[BUILT_IN]} />,
      );

      expect(await screen.findByText("Instant Evals")).toBeInTheDocument();
      expect(screen.queryByText(/Update needed/i)).not.toBeInTheDocument();
    });
  });
});

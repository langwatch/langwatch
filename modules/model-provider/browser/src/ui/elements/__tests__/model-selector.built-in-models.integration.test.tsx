/**
 * @vitest-environment jsdom
 * @see modules/instant-eval/specs/instant-eval-judge-model.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ providers: [] as unknown[] }));

vi.mock("@langwatch/browser-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "proj-1" } }),
}));

vi.mock("../../../behavior/model-provider-api.ts", () => ({
  api: {
    modelProvider: {
      listAllForProjectForFrontend: {
        useQuery: () => ({ data: state.providers, isLoading: false }),
      },
    },
  },
}));

import { LLMModelDisplay } from "../llm-model-display.tsx";
import { ModelSelector } from "../model-selector.tsx";

const BUILT_IN = { value: "langwatch/instant-evals", label: "Instant Evals" };
const LABELLED_NOT_OFFERED = { ...BUILT_IN, isOffered: false };

beforeEach(() => {
  state.providers = [];
});
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

  describe("given a project with a model provider", () => {
    beforeEach(() => {
      state.providers = [{ provider: "openai", enabled: true, customModels: null }];
    });

    describe("when the chosen model is a built-in model that is labelled but not offered", () => {
      /** @scenario "The model picker names a saved Instant Evals judge it does not offer" */
      it("names it, asks for no update, and does not list it", () => {
        renderWithDesignSystem(
          <ModelSelector
            model="langwatch/instant-evals"
            options={["openai/gpt-5-mini"]}
            onChange={() => undefined}
            builtInModels={[LABELLED_NOT_OFFERED]}
          />,
        );

        const listbox = screen.getByRole("listbox", { hidden: true });
        expect(within(listbox).queryByText("Instant Evals")).not.toBeInTheDocument();
        expect(screen.getAllByText("Instant Evals").length).toBeGreaterThan(0);
        expect(screen.queryByText("langwatch/instant-evals")).not.toBeInTheDocument();
        expect(screen.queryByText(/Update needed/i)).not.toBeInTheDocument();
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

  describe("given a chosen built-in model that is labelled but not offered", () => {
    it("shows its label and asks for no update", async () => {
      renderWithDesignSystem(
        <LLMModelDisplay model="langwatch/instant-evals" builtInModels={[LABELLED_NOT_OFFERED]} />,
      );

      expect(await screen.findByText("Instant Evals")).toBeInTheDocument();
      expect(screen.queryByText(/Update needed/i)).not.toBeInTheDocument();
    });
  });
});

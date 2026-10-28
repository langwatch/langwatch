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

// The project's stored providers, per test; empty unless a test enables one.
const storedProviders: { current: unknown[] } = { current: [] };

vi.mock("../../../behavior/model-provider-api.ts", () => ({
  api: {
    modelProvider: {
      listAllForProjectForFrontend: {
        useQuery: () => ({ data: storedProviders.current, isLoading: false }),
      },
    },
  },
}));

import { LLMModelDisplay } from "../llm-model-display.tsx";
import { ModelSelector } from "../model-selector.tsx";

const BUILT_IN = { value: "langwatch/instant-evals", label: "Instant Evals" };
const OWN_DECISION_BUILT_IN = {
  value: "openai/decisions:gpt-6-luna",
  label: "OpenAI Decisions (gpt-6-luna)",
};
const UNSTORED_PROVIDER_BUILT_IN = { value: "cloudflare/decisions:clef", label: "Cloudflare Clef" };

afterEach(() => {
  cleanup();
  storedProviders.current = [];
});

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

  describe("given a stored provider and a built-in model carrying its prefix", () => {
    it("heads one built-in group, apart from that provider's own group", () => {
      storedProviders.current = [{ provider: "openai", enabled: true, customModels: null }];

      renderWithDesignSystem(
        <ModelSelector
          model=""
          options={["openai/gpt-5-mini"]}
          onChange={() => undefined}
          builtInModels={[BUILT_IN, OWN_DECISION_BUILT_IN]}
        />,
      );

      const listbox = screen.getByRole("listbox", { hidden: true });
      expect(within(listbox).getAllByText("LangWatch")).toHaveLength(1);
      expect(within(listbox).getByText("OpenAI")).toBeInTheDocument();
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

  describe("given a built-in model whose prefix heads no group of the project's", () => {
    it("shows its label and asks for no update", async () => {
      storedProviders.current = [{ provider: "openai", enabled: true, customModels: null }];

      renderWithDesignSystem(
        <LLMModelDisplay
          model={UNSTORED_PROVIDER_BUILT_IN.value}
          builtInModels={[BUILT_IN, UNSTORED_PROVIDER_BUILT_IN]}
        />,
      );

      expect(await screen.findByText(UNSTORED_PROVIDER_BUILT_IN.label)).toBeInTheDocument();
      expect(screen.queryByText(/Update needed/i)).not.toBeInTheDocument();
    });
  });
});

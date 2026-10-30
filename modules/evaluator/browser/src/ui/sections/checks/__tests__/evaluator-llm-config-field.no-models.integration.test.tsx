// @vitest-environment jsdom
/**
 * The judge's picker offers Instant Evals only when the server releases the project, whatever
 * the flag says; the stand-in for the lent picker lists exactly the options this field hands it.
 * @see modules/instant-eval/specs/instant-eval-judge-model.feature
 */

import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { INSTANT_EVALS_FLAG } from "@langwatch/instant-eval-contract";
import { cleanup, screen } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const OWN_DECISION_MODEL = {
  value: "openai/decisions:gpt-6-luna",
  label: "OpenAI Decisions (gpt-6-luna)",
};
const HOSTED_DECISION_MODEL = {
  value: "langwatch/instant-evals",
  label: "LangWatch Instant Preview",
};

const state = vi.hoisted(() => ({
  flagReleased: false,
  released: false,
  providers: [] as unknown[],
  decisionModels: [] as { value: string; label: string }[],
}));

vi.mock("@langwatch/browser-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1", slug: "proj-1" },
    organization: { id: "org-1" },
  }),
}));

// Read at render time, after the constant's import has resolved.
vi.mock("@langwatch/feature-flag-client", () => ({
  useFeatureFlag: ({ name }: { name: string }) => ({
    enabled: name === INSTANT_EVALS_FLAG && state.flagReleased,
    isLoading: false,
  }),
}));

vi.mock("../../../../behavior/evaluator-api.ts", () => ({
  evaluatorApi: {
    modelProvider: {
      listAllForProjectForFrontend: {
        useQuery: () => ({ data: state.providers, isLoading: false }),
      },
      listDecisionModelsForProject: {
        useQuery: () => ({ data: state.decisionModels, isLoading: false }),
      },
    },
    instantEval: {
      access: {
        useQuery: () => ({
          data: { released: state.released, offer: "enable" },
          isLoading: false,
        }),
      },
    },
  },
}));

vi.mock("../../../../behavior/lent-model-provider.tsx", () => ({
  LLMModelDisplay: () => <span>model display</span>,
}));

vi.mock("../../../../behavior/lent-peers.tsx", () => ({
  LLMConfigPopover: ({ builtInModels }: { builtInModels?: { label: string }[] }) => (
    <ul aria-label="model options">
      {builtInModels?.map((model) => (
        <li key={model.label}>{model.label}</li>
      ))}
    </ul>
  ),
}));

import { EvaluatorLLMConfigField } from "../evaluator-llm-config-field.tsx";

const CONFIGURED_PROVIDER = { provider: "openai", enabled: true, customModels: null };

beforeEach(() => {
  state.flagReleased = false;
  state.released = false;
  state.providers = [];
  state.decisionModels = [];
});
afterEach(() => cleanup());

function renderField() {
  const Harness = () => {
    const methods = useForm({ defaultValues: { settings: {} } });
    return (
      <FormProvider {...methods}>
        <EvaluatorLLMConfigField prefix="settings" />
      </FormProvider>
    );
  };
  renderWithDesignSystem(<Harness />);
}

function offersInstantEvals(): boolean {
  return screen.queryByText("Instant Evals") !== null;
}

function offeredLabels(): string[] {
  return screen.queryAllByRole("listitem").map((option) => option.textContent ?? "");
}

describe("EvaluatorLLMConfigField", () => {
  it("reads the release flag by its shared name", () => {
    expect(INSTANT_EVALS_FLAG).toBe("release_instant_evals");
  });

  describe("given a project with a model provider", () => {
    beforeEach(() => {
      state.providers = [CONFIGURED_PROVIDER];
    });

    describe("when the server releases Instant Evals", () => {
      /** @scenario "The judge model picker shows Instant Evals when released" */
      it("offers Instant Evals among the picker's options", () => {
        state.released = true;
        renderField();

        expect(offersInstantEvals()).toBe(true);
      });
    });

    describe("when the server does not release Instant Evals", () => {
      /** @scenario "The judge model picker hides Instant Evals when not released" */
      it("does not offer Instant Evals", () => {
        renderField();

        expect(screen.queryByLabelText("model options")).not.toBeNull();
        expect(offersInstantEvals()).toBe(false);
      });
    });

    describe("when release_instant_evals is on but the server does not release Instant Evals", () => {
      /** @scenario "The release flag alone does not put Instant Evals in the picker" */
      it("does not offer Instant Evals", () => {
        state.flagReleased = true;
        renderField();

        expect(screen.queryByLabelText("model options")).not.toBeNull();
        expect(offersInstantEvals()).toBe(false);
      });
    });

    describe("when the server answers with Instant Evals and an own decision model", () => {
      beforeEach(() => {
        state.released = true;
        state.decisionModels = [HOSTED_DECISION_MODEL, OWN_DECISION_MODEL];
      });

      /** @scenario "The judge model picker offers the project's own decision models" */
      it("offers Instant Evals first, then the own decision model", () => {
        renderField();

        expect(offeredLabels()).toEqual(["Instant Evals", OWN_DECISION_MODEL.label]);
      });
    });

    describe("when the server answers with the hosted model only", () => {
      /** @scenario "The picker offers Instant Evals alone when the server offers no own model" */
      it("offers Instant Evals and nothing else", () => {
        state.released = true;
        state.decisionModels = [HOSTED_DECISION_MODEL];
        renderField();

        expect(offeredLabels()).toEqual(["Instant Evals"]);
      });
    });

    describe("when the server does not release Instant Evals but answers with an own model", () => {
      /** @scenario "The picker offers nothing of its own when Instant Evals are not released" */
      it("offers neither Instant Evals nor the own decision model", () => {
        state.decisionModels = [HOSTED_DECISION_MODEL, OWN_DECISION_MODEL];
        renderField();

        expect(offeredLabels()).toEqual([]);
      });
    });
  });

  describe("given a project with no model provider", () => {
    describe("when Instant Evals is not released", () => {
      it("shows that no models are configured", () => {
        renderField();

        expect(screen.queryByText(/No models configured/i)).not.toBeNull();
        expect(screen.queryByText("model display")).toBeNull();
      });
    });

    describe("when the server releases Instant Evals", () => {
      /** @scenario "A project with no model provider can still pick Instant Evals" */
      it("keeps the picker and offers Instant Evals", () => {
        state.released = true;
        renderField();

        expect(screen.queryByText(/No models configured/i)).toBeNull();
        expect(offersInstantEvals()).toBe(true);
      });
    });
  });
});

// @vitest-environment jsdom
/**
 * The judge's model picker offers Instant Evals behind the release flag or the
 * organization's own opt-in; the picker itself is lent by the prompt module, so
 * the stand-in lists exactly the options this field hands it.
 * @see modules/instant-eval/specs/instant-eval-judge-model.feature
 */

import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { INSTANT_EVALS_FLAG } from "@langwatch/instant-eval-contract";
import { cleanup, screen } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  flagReleased: false,
  optedIn: false,
  providers: [] as unknown[],
}));

vi.mock("@langwatch/browser-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1", slug: "proj-1" },
    organization: { id: "org-1" },
  }),
}));

// Read at render time, after the constant's import has resolved.
vi.mock("@langwatch/browser-host/feature-flag", () => ({
  useFeatureFlag: (name: string) => ({
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
    },
    traces: {
      instantEval: {
        access: {
          useQuery: () => ({
            data: { released: state.optedIn, offer: "enable" },
            isLoading: false,
          }),
        },
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
  state.optedIn = false;
  state.providers = [];
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

describe("EvaluatorLLMConfigField", () => {
  it("reads the release flag by its shared name", () => {
    expect(INSTANT_EVALS_FLAG).toBe("release_instant_evals");
  });

  describe("given a project with a model provider", () => {
    beforeEach(() => {
      state.providers = [CONFIGURED_PROVIDER];
    });

    describe("when release_instant_evals is on", () => {
      /** @scenario "The judge model picker shows Instant Evals when released" */
      it("offers Instant Evals among the picker's options", () => {
        state.flagReleased = true;
        renderField();

        expect(offersInstantEvals()).toBe(true);
      });
    });

    describe("when the flag is off but the organization opted in", () => {
      /** @scenario "The judge model picker shows Instant Evals to an organization that opted in" */
      it("offers Instant Evals among the picker's options", () => {
        state.optedIn = true;
        renderField();

        expect(offersInstantEvals()).toBe(true);
      });
    });

    describe("when release_instant_evals is off and the organization has not opted in", () => {
      /** @scenario "The judge model picker hides Instant Evals when not released" */
      it("does not offer Instant Evals", () => {
        renderField();

        expect(screen.queryByLabelText("model options")).not.toBeNull();
        expect(offersInstantEvals()).toBe(false);
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

    describe("when release_instant_evals is on", () => {
      /** @scenario "A project with no model provider can still pick Instant Evals" */
      it("keeps the picker and offers Instant Evals", () => {
        state.flagReleased = true;
        renderField();

        expect(screen.queryByText(/No models configured/i)).toBeNull();
        expect(offersInstantEvals()).toBe(true);
      });
    });
  });
});

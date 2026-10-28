// @vitest-environment jsdom
/**
 * An unresolved decision model list is not an empty one: until the server answers, the field
 * shows no model, so a judge saved on an own decision model is never marked for an update.
 * @see modules/instant-eval/specs/instant-eval-judge-model.feature
 */

import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const OWN_DECISION_MODEL = {
  value: "openai/decisions:gpt-6-luna",
  label: "OpenAI Decisions (gpt-6-luna)",
};

const state = vi.hoisted(() => ({
  decisionModels: [] as { value: string; label: string }[],
  decisionModelsLoading: false,
}));

vi.mock("@langwatch/browser-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1", slug: "proj-1" },
    organization: { id: "org-1" },
  }),
}));

vi.mock("@langwatch/feature-flag-client", () => ({
  useFeatureFlag: () => ({ enabled: false, isLoading: false }),
}));

const STORED_OPENAI = { provider: "openai", enabled: true, customModels: null };

vi.mock("../../../../behavior/evaluator-api.ts", () => ({
  evaluatorApi: {
    modelProvider: {
      listAllForProjectForFrontend: {
        useQuery: () => ({ data: [STORED_OPENAI], isLoading: false }),
      },
      listDecisionModelsForProject: {
        useQuery: () => ({
          data: state.decisionModelsLoading ? undefined : state.decisionModels,
          isLoading: state.decisionModelsLoading,
        }),
      },
    },
    instantEval: {
      access: {
        useQuery: () => ({ data: { released: true, offer: "enable" }, isLoading: false }),
      },
    },
  },
}));

// The real display lives behind model-provider's lent token, so the stand-in stands for
// "a model is on screen": that is what the warning this test guards against would ride on.
vi.mock("../../../../behavior/lent-model-provider.tsx", () => ({
  LLMModelDisplay: ({ model }: { model: string }) => (
    <span data-testid="model-display">{model}</span>
  ),
}));

vi.mock("../../../../behavior/lent-peers.tsx", () => ({
  LLMConfigPopover: () => <div data-testid="llm-config-popover" />,
}));

import { EvaluatorLLMConfigField } from "../evaluator-llm-config-field.tsx";

beforeEach(() => {
  state.decisionModels = [];
  state.decisionModelsLoading = false;
});
afterEach(() => cleanup());

function renderFieldOn(model: string) {
  const Harness = () => {
    const methods = useForm({ defaultValues: { settings: { model } } });
    return (
      <FormProvider {...methods}>
        <EvaluatorLLMConfigField prefix="settings" />
      </FormProvider>
    );
  };
  renderWithDesignSystem(<Harness />);
}

describe("EvaluatorLLMConfigField", () => {
  describe("given a judge saved on an own decision model and a stored model provider", () => {
    describe("when the project's decision models have not been answered yet", () => {
      /** @scenario "A judge's model waits for the decision models before it is marked" */
      it("shows no model at all, so nothing can mark it as needing an update", () => {
        state.decisionModelsLoading = true;
        renderFieldOn(OWN_DECISION_MODEL.value);

        expect(screen.queryByTestId("model-display")).toBeNull();
      });
    });

    describe("when the server has answered with that decision model", () => {
      it("shows the model", () => {
        state.decisionModels = [OWN_DECISION_MODEL];
        renderFieldOn(OWN_DECISION_MODEL.value);

        expect(screen.getByTestId("model-display")).toHaveTextContent(OWN_DECISION_MODEL.value);
      });
    });
  });
});

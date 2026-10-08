// @vitest-environment jsdom
/**
 * Every evaluator form renders its model through this one form, so it hands the
 * picker the evaluator it edits and only an LLM judge's picker offers Instant Evals.
 * @see modules/instant-eval/specs/instant-eval-judge-model.feature
 */

import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen, within } from "@testing-library/react";
import { type FieldValues, FormProvider, useForm } from "react-hook-form";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("@langwatch/browser-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1", slug: "proj-1" },
    organization: { id: "org-1" },
  }),
}));

vi.mock("@langwatch/browser-host/feature-flag", () => ({
  useFeatureFlag: () => ({ enabled: true, isLoading: false }),
}));

vi.mock("../../../../behavior/use-evaluator-default-models.ts", () => ({
  useEvaluatorDefaultModels: () => ({
    resolvedDefaultModel: { data: void 0 },
    resolvedDefaultEmbeddings: { data: void 0 },
  }),
}));

vi.mock("../../../../behavior/evaluator-api.ts", () => ({
  evaluatorApi: {
    modelProvider: {
      listAllForProjectForFrontend: {
        useQuery: () => ({
          data: [{ provider: "openai", enabled: true, customModels: null }],
          isLoading: false,
        }),
      },
    },
    traces: {
      instantEval: {
        access: {
          useQuery: () => ({ data: { released: true, offer: "enable" }, isLoading: false }),
        },
      },
    },
  },
}));

vi.mock("../../../../behavior/lent-model-provider.tsx", () => ({
  LLMModelDisplay: ({ model }: { model: string }) => <span>model display {model}</span>,
}));

vi.mock("../../../../behavior/lent-peers.tsx", () => ({
  LLMConfigPopover: ({
    builtInModels,
  }: {
    builtInModels?: { label: string; isOffered?: boolean }[];
  }) => (
    <ul aria-label="model options">
      {builtInModels
        ?.filter((model) => model.isOffered !== false)
        .map((model) => (
          <li key={model.label}>{model.label}</li>
        ))}
    </ul>
  ),
}));

import DynamicZodForm from "../dynamic-zod-form.tsx";

afterEach(() => cleanup());

// The model and max_tokens pair the form renders as one model picker.
const llmSchema = z.object({ model: z.string(), max_tokens: z.number() });

function renderForm({
  evaluatorType,
  variant,
}: {
  evaluatorType: string;
  variant: "default" | "studio";
}) {
  const Harness = () => {
    const methods = useForm<FieldValues>({
      defaultValues: { settings: { model: "openai/gpt-5-mini", max_tokens: 100 } },
    });
    return (
      <FormProvider {...methods}>
        <DynamicZodForm
          schema={llmSchema}
          evaluatorType={evaluatorType}
          prefix="settings"
          errors={void 0}
          variant={variant}
        />
      </FormProvider>
    );
  };
  renderWithDesignSystem(<Harness />);
}

function offersInstantEvals(): boolean {
  const options = screen.getByLabelText("model options");
  return within(options).queryByText("Instant Evals") !== null;
}

describe("DynamicZodForm model picker", () => {
  describe.each([
    { form: "evaluator settings", variant: "default" as const },
    { form: "Studio evaluator node", variant: "studio" as const },
  ])("given the $form with Instant Evals released", ({ variant }) => {
    describe("when it edits an LLM evaluator that is not a judge", () => {
      /** @scenario "The evaluator settings form offers Instant Evals only for the LLM judge it edits" */
      it("does not offer Instant Evals", () => {
        renderForm({ evaluatorType: "ragas/faithfulness", variant });

        expect(offersInstantEvals()).toBe(false);
      });
    });

    describe("when it edits an LLM judge", () => {
      /** @scenario "The evaluator settings form offers Instant Evals only for the LLM judge it edits" */
      it("offers Instant Evals", () => {
        renderForm({ evaluatorType: "langevals/llm_boolean", variant });

        expect(offersInstantEvals()).toBe(true);
      });
    });
  });
});

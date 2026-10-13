// @vitest-environment jsdom
/**
 * The score judge's min and max only steer Instant Evals, so the form shows
 * them only while Instant Evals is the judge's model.
 * @see modules/instant-eval/specs/instant-eval-judge-model.feature
 */

import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { INSTANT_EVAL_JUDGE_MODEL_ID } from "@langwatch/instant-eval-judge-contract";
import { act, cleanup, screen } from "@testing-library/react";
import { type FieldValues, FormProvider, useForm, type UseFormReturn } from "react-hook-form";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("@langwatch/browser-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "proj-1", slug: "proj-1" } }),
}));

vi.mock("../../../../behavior/use-evaluator-default-models.ts", () => ({
  useEvaluatorDefaultModels: () => ({
    resolvedDefaultModel: { data: void 0 },
    resolvedDefaultEmbeddings: { data: void 0 },
  }),
}));

import DynamicZodForm from "../dynamic-zod-form.tsx";

afterEach(() => cleanup());

// The score judge's own settings, less the model field the composite picker renders.
const scoreSchema = z.object({
  prompt: z.string(),
  min: z.number().optional(),
  max: z.number().optional(),
});

function renderScoreJudge({ model }: { model: string }) {
  const form: { current?: UseFormReturn } = {};
  const Harness = () => {
    const methods = useForm<FieldValues>({ defaultValues: { settings: { model } } });
    form.current = methods;
    return (
      <FormProvider {...methods}>
        <DynamicZodForm
          schema={scoreSchema}
          evaluatorType="langevals/llm_score"
          prefix="settings"
          errors={void 0}
        />
      </FormProvider>
    );
  };
  renderWithDesignSystem(<Harness />);
  return { form };
}

function scoreRangeInputs() {
  return screen.queryAllByRole("spinbutton");
}

describe("DynamicZodForm score range", () => {
  describe("given a score judge", () => {
    describe("when a member picks Instant Evals as its model", () => {
      /** @scenario "The score range shows only for Instant Evals" */
      it("shows the score range fields, and hides them again for any other model", () => {
        const { form } = renderScoreJudge({ model: "openai/gpt-5-mini" });
        expect(scoreRangeInputs()).toHaveLength(0);

        act(() => form.current!.setValue("settings.model", INSTANT_EVAL_JUDGE_MODEL_ID));
        expect(scoreRangeInputs()).toHaveLength(2);

        act(() => form.current!.setValue("settings.model", "anthropic/claude-sonnet-4"));
        expect(scoreRangeInputs()).toHaveLength(0);
      });
    });
  });

  describe("given an evaluator that is not the score judge", () => {
    it("keeps its own min and max fields whatever the model", () => {
      renderWithDesignSystem(<OtherEvaluator />);

      expect(scoreRangeInputs()).toHaveLength(2);
    });
  });
});

function OtherEvaluator() {
  const methods = useForm<FieldValues>({ defaultValues: { settings: { model: "" } } });
  return (
    <FormProvider {...methods}>
      <DynamicZodForm
        schema={scoreSchema}
        evaluatorType="custom/unknown"
        prefix="settings"
        errors={void 0}
      />
    </FormProvider>
  );
}

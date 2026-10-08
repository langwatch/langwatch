/**
 * @vitest-environment jsdom
 * A studio evaluator node fills its settings from the same defaults as the
 * evaluator editor, so a released project with no provider starts a judge on Instant Evals.
 * @see modules/instant-eval/specs/instant-eval-judge-model.feature
 */
import { INSTANT_EVAL_JUDGE_MODEL_ID } from "@langwatch/instant-eval-judge-contract";
import { DEFAULT_MODEL } from "@langwatch/model-provider-contract";
import { renderHook, waitFor } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  flagReleased: false,
}));

vi.mock("@langwatch/browser-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "p1", slug: "p1" },
    organization: { id: "org-1" },
  }),
}));
vi.mock("@langwatch/browser-host/feature-flag", () => ({
  useFeatureFlag: () => ({ enabled: state.flagReleased, isLoading: false }),
}));
vi.mock("../../../../behavior/evaluator-api.ts", () => ({
  evaluatorApi: {
    evaluations: {
      availableCustomEvaluators: { useQuery: () => ({ data: [], isLoading: false }) },
    },
    modelProvider: {
      getResolvedDefault: { useQuery: () => ({ data: null, isLoading: false }) },
      listAllForProjectForFrontend: { useQuery: () => ({ data: [], isLoading: false }) },
    },
    traces: {
      instantEval: {
        access: {
          useQuery: () => ({ data: { released: false, offer: "enable" }, isLoading: false }),
        },
      },
    },
  },
}));

import { useEvaluatorDefaultSettings } from "../use-evaluator-default-settings.ts";

function renderStudioNodeDefaults({ evaluatorType }: { evaluatorType: string }) {
  return renderHook(() => {
    const form = useForm<{ settings: Record<string, unknown> }>({
      defaultValues: { settings: {} },
    });
    useEvaluatorDefaultSettings({ form, evaluatorType, enabled: true });
    return form;
  });
}

describe("useEvaluatorDefaultSettings", () => {
  beforeEach(() => {
    state.flagReleased = false;
  });

  describe("given a project with no model provider and no default model", () => {
    describe("when Instant Evals is released and a judge node is added", () => {
      /** @scenario "A new judge in a project with no model provider starts on Instant Evals when released" */
      it("starts the judge on Instant Evals", async () => {
        state.flagReleased = true;
        const { result } = renderStudioNodeDefaults({ evaluatorType: "langevals/llm_boolean" });

        await waitFor(() => {
          expect(result.current.getValues("settings.model" as never)).toBe(
            INSTANT_EVAL_JUDGE_MODEL_ID,
          );
        });
      });
    });

    describe("when Instant Evals is not released and a judge node is added", () => {
      /** @scenario "A new evaluator keeps the platform default model otherwise" */
      it("keeps the platform default model", async () => {
        const { result } = renderStudioNodeDefaults({ evaluatorType: "langevals/llm_boolean" });

        await waitFor(() => {
          expect(result.current.getValues("settings.model" as never)).toBe(DEFAULT_MODEL);
        });
      });
    });
  });
});

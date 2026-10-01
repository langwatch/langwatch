/**
 * @vitest-environment jsdom
 * The create form fills its model from the cascade-resolved default. It resets
 * once per evaluator type and latches, so a reset during loading must not leave
 * the model on the platform fallback for good.
 */
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type QueryState = {
  data: { model: string } | null | undefined;
  isLoading: boolean;
};

const queries: Record<string, QueryState> = {
  "prompt.create_default": { data: undefined, isLoading: true },
  "analytics.topic_clustering_embeddings": { data: undefined, isLoading: true },
};

vi.mock("@langwatch/browser-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "p1", slug: "p1" } }),
}));
vi.mock("@langwatch/browser-host/use-drawer", () => ({
  getComplexProps: () => ({}),
  getDrawerStack: () => [],
  getFlowCallbacks: () => undefined,
  useDrawer: () => ({
    closeDrawer: vi.fn(),
    canGoBack: false,
    goBack: vi.fn(),
  }),
  useDrawerParams: () => ({}),
}));
const { mutation } = vi.hoisted(() => ({
  mutation: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("../../../../behavior/evaluator-api.ts", () => {
  return {
    evaluatorApi: {
      useUtils: () => ({
        evaluators: {
          getAll: { invalidate: vi.fn() },
          getById: { invalidate: vi.fn() },
        },
      }),
      modelProvider: {
        getResolvedDefault: {
          useQuery: ({ featureKey }: { featureKey: string }) => queries[featureKey],
        },
      },
    },
  };
});
vi.mock("@langwatch/evaluator-client", () => ({
  evaluatorClient: {
    useUtils: () => ({
      evaluators: {
        getAll: { invalidate: vi.fn() },
        getById: { invalidate: vi.fn() },
      },
    }),
    evaluators: {
      getById: {
        useQuery: () => ({ data: undefined, isLoading: false }),
      },
      create: { useMutation: mutation },
      update: { useMutation: mutation },
    },
  },
}));

import { DEFAULT_MODEL } from "@langwatch/model-provider-contract";

import { useEvaluatorEditorController } from "../evaluator-editor-shared.tsx";

const CONFIGURED_MODEL = "anthropic/claude-opus-5-5";

describe("useEvaluatorEditorController", () => {
  beforeEach(() => {
    queries["prompt.create_default"] = { data: undefined, isLoading: true };
    queries["analytics.topic_clustering_embeddings"] = {
      data: undefined,
      isLoading: true,
    };
  });

  describe("given the configured default model is still loading", () => {
    describe("when a new LLM-as-a-Judge evaluator form opens", () => {
      /** @scenario A new evaluator waits for the configured default before filling its model */
      it("fills the model with the configured default once it loads", async () => {
        const { result, rerender } = renderHook(() =>
          useEvaluatorEditorController({
            isOpen: true,
            evaluatorType: "langevals/llm_boolean",
          }),
        );

        queries["prompt.create_default"] = {
          data: { model: CONFIGURED_MODEL, source: "role_default" } as never,
          isLoading: false,
        };
        queries["analytics.topic_clustering_embeddings"] = {
          data: null,
          isLoading: false,
        };
        rerender();

        await waitFor(() => {
          expect(result.current.form.getValues("settings.model" as never)).toBe(CONFIGURED_MODEL);
        });
        expect(CONFIGURED_MODEL).not.toBe(DEFAULT_MODEL);
      });

      /** @scenario A new evaluator waits for the configured default before filling its model */
      it("holds the form as loading until the defaults answer", async () => {
        const { result, rerender } = renderHook(() =>
          useEvaluatorEditorController({
            isOpen: true,
            evaluatorType: "langevals/llm_boolean",
          }),
        );

        expect(result.current.isLoadingEvaluator).toBe(true);

        queries["prompt.create_default"] = {
          data: { model: CONFIGURED_MODEL, source: "role_default" } as never,
          isLoading: false,
        };
        queries["analytics.topic_clustering_embeddings"] = {
          data: null,
          isLoading: false,
        };
        rerender();

        await waitFor(() => {
          expect(result.current.isLoadingEvaluator).toBe(false);
        });
      });
    });
  });

  describe("given the project has no configured default model", () => {
    describe("when a new LLM-as-a-Judge evaluator form opens", () => {
      it("falls back to the platform default model", async () => {
        queries["prompt.create_default"] = { data: null, isLoading: false };
        queries["analytics.topic_clustering_embeddings"] = {
          data: null,
          isLoading: false,
        };

        const { result } = renderHook(() =>
          useEvaluatorEditorController({
            isOpen: true,
            evaluatorType: "langevals/llm_boolean",
          }),
        );

        await waitFor(() => {
          expect(result.current.form.getValues("settings.model" as never)).toBe(DEFAULT_MODEL);
        });
      });
    });
  });
});

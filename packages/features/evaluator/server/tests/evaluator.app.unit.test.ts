/**
 * @vitest-environment node
 *
 * The evaluator application: the rules that moved off its two doors onto it.
 *
 *   - the evaluator-id scheme, which three call sites used to mint for
 *     themselves;
 *   - "look it up by id, and failing that by slug", which is what an
 *     evaluator's public address MEANS rather than something the REST reader
 *     decided;
 *   - resolving the project's default model when a create names none, and
 *     tolerating a project that has configured no embeddings model;
 *   - refusing a code evaluator whose config carries no program.
 *
 * The services are stubbed. Nothing here speaks HTTP or tRPC.
 */
import type {
  Evaluator,
  EvaluatorService,
  EvaluatorWithFields,
} from "@langwatch/evaluator-contract";
import {
  ModelNotConfiguredError,
  type ModelProviderService,
} from "@langwatch/model-provider-contract";
import { describe, expect, it, vi } from "vitest";
import { EvaluatorApp } from "../src/app/evaluator.app";

const NOW = new Date("2026-08-24T00:00:00.000Z");

const evaluator = {
  id: "evaluator_1",
  projectId: "project-1",
  name: "Exact match",
  slug: "exact-match",
  type: "evaluator",
  config: { evaluatorType: "langevals/exact_match", settings: {} },
  workflowId: null,
  copiedFromEvaluatorId: null,
  createdAt: NOW,
  updatedAt: NOW,
} as unknown as Evaluator;

const withFields = { ...evaluator, fields: [], outputFields: [] } as EvaluatorWithFields;

/** A program a code evaluator can actually run. */
const runnableCode = {
  code: "def evaluate(): return True",
  inputs: [{ identifier: "input", type: "str" }],
  outputs: [{ identifier: "passed", type: "bool" }],
};

function harness({
  evaluators = {},
  modelProviders = {},
}: {
  evaluators?: Record<string, unknown>;
  modelProviders?: Record<string, unknown>;
} = {}) {
  const evaluatorService = {
    tryGetByIdWithFields: vi.fn(async () => withFields),
    getByIdWithFields: vi.fn(async () => withFields),
    tryGetBySlug: vi.fn(async () => evaluator),
    create: vi.fn(async () => evaluator),
    createWithDefaults: vi.fn(async () => evaluator),
    update: vi.fn(async () => evaluator),
    ...evaluators,
  } as unknown as EvaluatorService;

  const modelProviderService = {
    resolveModelForFeature: vi.fn(async ({ featureKey }: { featureKey: string }) => ({
      model:
        featureKey === "evaluator.create_default"
          ? "anthropic/claude-sonnet-4-5"
          : "openai/text-embedding-3-large",
    })),
    ...modelProviders,
  } as unknown as ModelProviderService;

  return {
    evaluators: evaluatorService,
    modelProviders: modelProviderService,
    app: EvaluatorApp.create({
      evaluators: evaluatorService,
      modelProviders: modelProviderService,
    }),
  };
}

/** The single argument a stubbed method was called with. */
function firstCall(method: unknown): Record<string, unknown> {
  const mock = method as { mock: { calls: unknown[][] } };
  return mock.mock.calls[0]?.[0] as Record<string, unknown>;
}

describe("EvaluatorApp", () => {
  describe("when a new evaluator needs an id", () => {
    it("mints it under the one scheme every call site now shares", () => {
      const { app } = harness();

      expect(app.newEvaluatorId()).toMatch(/^evaluator_.+/);
      expect(app.newEvaluatorId()).not.toBe(app.newEvaluatorId());
    });
  });

  describe("when an evaluator is addressed the way the public API addresses it", () => {
    it("answers the id match without ever reaching for a slug", async () => {
      const { app, evaluators } = harness();

      await expect(
        app.tryGetByIdOrSlugWithFields({ idOrSlug: "evaluator_1", projectId: "project-1" }),
      ).resolves.toEqual(withFields);
      expect(evaluators.tryGetBySlug).not.toHaveBeenCalled();
    });

    it("falls back to the slug, then reads the row back with its fields", async () => {
      const { app, evaluators } = harness({
        evaluators: { tryGetByIdWithFields: vi.fn(async () => null) },
      });

      await expect(
        app.tryGetByIdOrSlugWithFields({ idOrSlug: "exact-match", projectId: "project-1" }),
      ).resolves.toEqual(withFields);
      expect(evaluators.tryGetBySlug).toHaveBeenCalledWith({
        slug: "exact-match",
        projectId: "project-1",
      });
      expect(evaluators.getByIdWithFields).toHaveBeenCalledWith({
        id: "evaluator_1",
        projectId: "project-1",
      });
    });

    it("answers null when neither the id nor the slug names one", async () => {
      const { app } = harness({
        evaluators: {
          tryGetByIdWithFields: vi.fn(async () => null),
          tryGetBySlug: vi.fn(async () => null),
        },
      });

      await expect(
        app.tryGetByIdOrSlugWithFields({ idOrSlug: "ghost", projectId: "project-1" }),
      ).resolves.toBeNull();
    });
  });

  describe("when a create names a config but no model", () => {
    it("runs the evaluator on the project's resolved default", async () => {
      const { app, evaluators, modelProviders } = harness();

      await app.createWithResolvedDefaults({
        projectId: "project-1",
        name: "Faithfulness",
        config: { evaluatorType: "ragas/faithfulness" },
      });

      expect(modelProviders.resolveModelForFeature).toHaveBeenCalledWith({
        projectId: "project-1",
        featureKey: "evaluator.create_default",
      });
      expect(firstCall(evaluators.createWithDefaults)).toMatchObject({
        projectId: "project-1",
        name: "Faithfulness",
        type: "evaluator",
        config: { evaluatorType: "ragas/faithfulness" },
        resolved: {
          defaultModel: "anthropic/claude-sonnet-4-5",
          embeddingsModel: "openai/text-embedding-3-large",
        },
      });
    });

    it("mints the id itself when the caller supplies none", async () => {
      const { app, evaluators } = harness();

      await app.createWithResolvedDefaults({
        projectId: "project-1",
        name: "Faithfulness",
        config: { evaluatorType: "ragas/faithfulness" },
      });

      expect(firstCall(evaluators.createWithDefaults).id).toMatch(/^evaluator_.+/);
    });

    it("keeps the id the caller did supply", async () => {
      const { app, evaluators } = harness();

      await app.createWithResolvedDefaults({
        projectId: "project-1",
        id: "evaluator_chosen",
        name: "Faithfulness",
        config: { evaluatorType: "ragas/faithfulness" },
      });

      expect(firstCall(evaluators.createWithDefaults).id).toBe("evaluator_chosen");
    });
  });

  describe("when the project has configured no embeddings model", () => {
    /**
     * An evaluator that needs no embeddings must still be creatable in a
     * project that has configured none, so the absence is a state rather than
     * a failure — unlike the default model's.
     */
    it("creates the evaluator with a null embeddings model", async () => {
      const { app, evaluators } = harness({
        modelProviders: {
          resolveModelForFeature: vi.fn(async ({ featureKey }: { featureKey: string }) => {
            if (featureKey === "analytics.topic_clustering_embeddings") {
              throw new ModelNotConfiguredError(
                featureKey,
                "EMBEDDINGS",
                "Topic clustering embeddings",
                "project-1",
              );
            }
            return { model: "anthropic/claude-sonnet-4-5" };
          }),
        },
      });

      await app.createWithResolvedDefaults({
        projectId: "project-1",
        name: "Faithfulness",
        config: { evaluatorType: "ragas/faithfulness" },
      });

      expect(firstCall(evaluators.createWithDefaults)).toMatchObject({
        resolved: { defaultModel: "anthropic/claude-sonnet-4-5", embeddingsModel: null },
      });
    });

    /**
     * @scenario A type that does need embeddings still refuses when none is configured
     *
     * The tolerance above is for types whose settings have no
     * `embeddings_model` field. `ragas/response_relevancy` has one, and the
     * settings defaults fill it from the catalog fallback — an OpenAI model
     * this organization never configured — so swallowing the absence writes an
     * evaluator that can only fail at RUN time against a provider it has no
     * key for.
     */
    it("refuses for a type whose settings do carry an embeddings model", async () => {
      const { app, evaluators } = harness({
        modelProviders: {
          resolveModelForFeature: vi.fn(async ({ featureKey }: { featureKey: string }) => {
            if (featureKey === "analytics.topic_clustering_embeddings") {
              throw new ModelNotConfiguredError(
                featureKey,
                "EMBEDDINGS",
                "Topic clustering embeddings",
                "project-1",
              );
            }
            return { model: "anthropic/claude-sonnet-4-5" };
          }),
        },
      });

      await expect(
        app.createWithResolvedDefaults({
          projectId: "project-1",
          name: "Response relevancy",
          config: { evaluatorType: "ragas/response_relevancy" },
        }),
      ).rejects.toMatchObject({ code: "model_not_configured", meta: { role: "EMBEDDINGS" } });
      expect(evaluators.createWithDefaults).not.toHaveBeenCalled();
    });

    it("still refuses when the DEFAULT model itself is unconfigured", async () => {
      const { app, evaluators } = harness({
        modelProviders: {
          resolveModelForFeature: vi.fn(async ({ featureKey }: { featureKey: string }) => {
            throw new ModelNotConfiguredError(
              featureKey,
              featureKey === "evaluator.create_default" ? "DEFAULT" : "EMBEDDINGS",
              "Evaluator default",
              "project-1",
            );
          }),
        },
      });

      await expect(
        app.createWithResolvedDefaults({
          projectId: "project-1",
          name: "Faithfulness",
          config: { evaluatorType: "ragas/faithfulness" },
        }),
      ).rejects.toMatchObject({ code: "model_not_configured" });
      expect(evaluators.createWithDefaults).not.toHaveBeenCalled();
    });

    it("lets an embeddings failure that is not a missing configuration through", async () => {
      const { app } = harness({
        modelProviders: {
          resolveModelForFeature: vi.fn(async ({ featureKey }: { featureKey: string }) => {
            if (featureKey === "analytics.topic_clustering_embeddings") {
              throw new Error("the model provider registry is unreachable");
            }
            return { model: "anthropic/claude-sonnet-4-5" };
          }),
        },
      });

      await expect(
        app.createWithResolvedDefaults({
          projectId: "project-1",
          name: "Faithfulness",
          config: { evaluatorType: "ragas/faithfulness" },
        }),
      ).rejects.toThrow("the model provider registry is unreachable");
    });
  });

  describe("when a code evaluator carries no program", () => {
    it("refuses the create before the service is reached", async () => {
      const { app, evaluators } = harness();

      await expect(
        app.create({
          id: "evaluator_2",
          projectId: "project-1",
          name: "Broken code check",
          type: "code",
          config: { evaluatorType: "code" },
        }),
      ).rejects.toMatchObject({ code: "evaluator_config_invalid" });
      expect(evaluators.create).not.toHaveBeenCalled();
    });

    it("refuses an update that would leave it without one", async () => {
      const { app, evaluators } = harness();

      await expect(
        app.update({
          id: "evaluator_2",
          projectId: "project-1",
          data: { type: "code", config: { evaluatorType: "code" } },
        }),
      ).rejects.toMatchObject({ code: "evaluator_config_invalid" });
      expect(evaluators.update).not.toHaveBeenCalled();
    });

    it("accepts one that does carry a program", async () => {
      const { app, evaluators } = harness();

      await app.create({
        id: "evaluator_2",
        projectId: "project-1",
        name: "Working code check",
        type: "code",
        config: runnableCode,
      });

      expect(evaluators.create).toHaveBeenCalled();
    });
  });
});

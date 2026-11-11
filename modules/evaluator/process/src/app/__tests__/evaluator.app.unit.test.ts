/**
 * @vitest-environment node
 */
import { codeEvaluatorOutputFields, newEvaluatorId } from "@langwatch/evaluator-contract";
import { ModelNotConfiguredError, type ModelProviderApi } from "@langwatch/model-provider-contract";
import { describe, expect, it, vi } from "vitest";

import { createEvaluatorTestApp, testModelResolution } from "./evaluator.fixture.ts";

/** A program a code evaluator can actually run. */
const runnableCode = {
  code: "def evaluate(): return True",
  inputs: [{ identifier: "input", type: "str" }],
  outputs: [{ identifier: "passed", type: "bool" }],
};

/**
 * The application over a real, empty repository. Neither the permission
 * service nor the graph is reached: the cases exercise the model resolution
 * and the id-or-slug lookup.
 */
function harness({
  modelProviders = {},
}: {
  modelProviders?: Partial<ModelProviderApi>;
} = {}) {
  return createEvaluatorTestApp({ modelProviders });
}

/** The single argument a spied method was called with. */
function firstCall(method: unknown): Record<string, unknown> {
  const mock = method as { mock: { calls: unknown[][] } };
  return mock.mock.calls[0]?.[0] as Record<string, unknown>;
}

describe("EvaluatorModule", () => {
  describe("when a new evaluator needs an id", () => {
    it("mints it under the one scheme every call site now shares", () => {
      expect(newEvaluatorId()).toMatch(/^evaluator_.+/);
      expect(newEvaluatorId()).not.toBe(newEvaluatorId());
    });
  });

  describe("when an evaluator is addressed the way the public API addresses it", () => {
    it("answers the id match without ever reaching for a slug", async () => {
      const { app, repository } = harness();
      await repository.create({
        id: "evaluator_1",
        projectId: "project-1",
        name: "Exact match",
        slug: "exact-match",
        type: "evaluator",
        config: {},
      });
      const findBySlug = vi.spyOn(repository, "findBySlug");

      const found = await app.findByIdOrSlugWithFields({
        idOrSlug: "evaluator_1",
        projectId: "project-1",
      });

      expect(found?.id).toBe("evaluator_1");
      expect(findBySlug).not.toHaveBeenCalled();
    });

    it("falls back to the slug, then reads the row back with its fields", async () => {
      const { app, repository } = harness();
      await repository.create({
        id: "evaluator_1",
        projectId: "project-1",
        name: "Exact match",
        slug: "exact-match",
        type: "evaluator",
        config: {},
      });

      const found = await app.findByIdOrSlugWithFields({
        idOrSlug: "exact-match",
        projectId: "project-1",
      });

      expect(found?.id).toBe("evaluator_1");
      expect(found?.slug).toBe("exact-match");
    });

    it("answers undefined when neither the id nor the slug names one", async () => {
      const { app } = harness();

      await expect(
        app.findByIdOrSlugWithFields({ idOrSlug: "ghost", projectId: "project-1" }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when a create names a config but no model", () => {
    it("runs the evaluator on the project's resolved default", async () => {
      const { app, repository, modelProviders } = harness();
      const create = vi.spyOn(repository, "create");
      const resolveModelForFeature = vi.spyOn(modelProviders, "resolveModelForFeature");

      await app.createWithResolvedDefaults({
        projectId: "project-1",
        name: "Faithfulness",
        config: { evaluatorType: "ragas/faithfulness" },
      });

      expect(resolveModelForFeature).toHaveBeenCalledWith({
        projectId: "project-1",
        featureKey: "evaluator.create_default",
      });
      expect(firstCall(create)).toMatchObject({
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
      const { app, repository } = harness();
      const create = vi.spyOn(repository, "create");

      await app.createWithResolvedDefaults({
        projectId: "project-1",
        name: "Faithfulness",
        config: { evaluatorType: "ragas/faithfulness" },
      });

      expect(firstCall(create).id).toMatch(/^evaluator_.+/);
    });

    it("keeps the id the caller did supply", async () => {
      const { app, repository } = harness();
      const create = vi.spyOn(repository, "create");

      await app.createWithResolvedDefaults({
        projectId: "project-1",
        id: "evaluator_chosen",
        name: "Faithfulness",
        config: { evaluatorType: "ragas/faithfulness" },
      });

      expect(firstCall(create).id).toBe("evaluator_chosen");
    });
  });

  describe("when the project has configured no embeddings model", () => {
    /**
     * An evaluator that needs no embeddings must still be creatable in a
     * project that has configured none, so the absence is a state rather than
     * a failure — unlike the default model's.
     */
    /** @scenario A type whose settings carry no embeddings_model asks for no embeddings model */
    /** @scenario A faithfulness evaluator is created with no embeddings default configured */
    it("creates the evaluator with a null embeddings model", async () => {
      const { app, repository } = harness({
        modelProviders: {
          resolveModelForFeature: vi.fn(async ({ featureKey }: { featureKey: string }) => {
            if (featureKey === "analytics.topic_clustering_embeddings") {
              throw new ModelNotConfiguredError({
                featureKey,
                role: "EMBEDDINGS",
                featureDisplayName: "Topic clustering embeddings",
                projectId: "project-1",
              });
            }
            return testModelResolution(featureKey, "anthropic/claude-sonnet-4-5");
          }),
        },
      });
      const create = vi.spyOn(repository, "create");

      await app.createWithResolvedDefaults({
        projectId: "project-1",
        name: "Faithfulness",
        config: { evaluatorType: "ragas/faithfulness" },
      });

      expect(firstCall(create)).toMatchObject({
        resolved: { defaultModel: "anthropic/claude-sonnet-4-5", embeddingsModel: null },
      });
    });

    /** @scenario A type with neither field asks for no model at all */
    it("creates a type with neither model field, tolerating the missing embeddings default", async () => {
      const { app, repository } = harness({
        modelProviders: {
          resolveModelForFeature: vi.fn(async ({ featureKey }: { featureKey: string }) => {
            if (featureKey === "analytics.topic_clustering_embeddings") {
              throw new ModelNotConfiguredError({
                featureKey,
                role: "EMBEDDINGS",
                featureDisplayName: "Topic clustering embeddings",
                projectId: "project-1",
              });
            }
            return testModelResolution(featureKey, "anthropic/claude-sonnet-4-5");
          }),
        },
      });
      const create = vi.spyOn(repository, "create");

      await app.createWithResolvedDefaults({
        projectId: "project-1",
        name: "Exact match",
        config: { evaluatorType: "langevals/exact_match" },
      });

      expect(firstCall(create)).toMatchObject({
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
    /** @scenario A type whose settings carry embeddings_model asks for both */
    it("refuses for a type whose settings do carry an embeddings model", async () => {
      const { app, repository } = harness({
        modelProviders: {
          resolveModelForFeature: vi.fn(async ({ featureKey }: { featureKey: string }) => {
            if (featureKey === "analytics.topic_clustering_embeddings") {
              throw new ModelNotConfiguredError({
                featureKey,
                role: "EMBEDDINGS",
                featureDisplayName: "Topic clustering embeddings",
                projectId: "project-1",
              });
            }
            return testModelResolution(featureKey, "anthropic/claude-sonnet-4-5");
          }),
        },
      });
      const create = vi.spyOn(repository, "create");

      await expect(
        app.createWithResolvedDefaults({
          projectId: "project-1",
          name: "Response relevancy",
          config: { evaluatorType: "ragas/response_relevancy" },
        }),
      ).rejects.toMatchObject({ code: "model_not_configured", meta: { role: "EMBEDDINGS" } });
      expect(create).not.toHaveBeenCalled();
    });

    /**
     * The tolerance is read off the type's own settings, so a type the
     * catalogue does not describe at all — a custom or workflow evaluator —
     * falls on the tolerant side rather than the refusing one. Getting this
     * backwards would make every custom evaluator uncreatable in a project
     * with no embeddings key, for a field it does not have.
     */
    /** @scenario An unknown or custom evaluator asks for no model at all */
    it("creates a type the catalogue does not describe, rather than demanding embeddings for it", async () => {
      const { app, repository } = harness({
        modelProviders: {
          resolveModelForFeature: vi.fn(async ({ featureKey }: { featureKey: string }) => {
            if (featureKey === "analytics.topic_clustering_embeddings") {
              throw new ModelNotConfiguredError({
                featureKey,
                role: "EMBEDDINGS",
                featureDisplayName: "Topic clustering embeddings",
                projectId: "project-1",
              });
            }
            return testModelResolution(featureKey, "anthropic/claude-sonnet-4-5");
          }),
        },
      });
      const create = vi.spyOn(repository, "create");

      await app.createWithResolvedDefaults({
        projectId: "project-1",
        name: "A workflow evaluator",
        config: { evaluatorType: "custom/not-in-the-catalogue" },
      });

      expect(firstCall(create)).toMatchObject({
        resolved: { defaultModel: "anthropic/claude-sonnet-4-5", embeddingsModel: null },
      });
    });

    it("still refuses when the DEFAULT model itself is unconfigured", async () => {
      const { app, repository } = harness({
        modelProviders: {
          resolveModelForFeature: vi.fn(async ({ featureKey }: { featureKey: string }) => {
            throw new ModelNotConfiguredError({
              featureKey,
              role: featureKey === "evaluator.create_default" ? "DEFAULT" : "EMBEDDINGS",
              featureDisplayName: "Evaluator default",
              projectId: "project-1",
            });
          }),
        },
      });
      const create = vi.spyOn(repository, "create");

      await expect(
        app.createWithResolvedDefaults({
          projectId: "project-1",
          name: "Faithfulness",
          config: { evaluatorType: "ragas/faithfulness" },
        }),
      ).rejects.toMatchObject({ code: "model_not_configured" });
      expect(create).not.toHaveBeenCalled();
    });

    it("lets an embeddings failure that is not a missing configuration through", async () => {
      const { app } = harness({
        modelProviders: {
          resolveModelForFeature: vi.fn(async ({ featureKey }: { featureKey: string }) => {
            if (featureKey === "analytics.topic_clustering_embeddings") {
              throw new Error("the model provider registry is unreachable");
            }
            return testModelResolution(featureKey, "anthropic/claude-sonnet-4-5");
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

  describe("when the public API creates a code evaluator", () => {
    const program = {
      code: "class Code:\n    def __call__(self, output: str):\n        return {}\n",
      inputs: [{ identifier: "output", type: "str" }],
    };
    const apiKey = { type: "api_key", id: "project-key-1" } as const;

    /** @scenario A code evaluator created through the API is stored like one the editor saved */
    it("stores it as the editor does, with the fixed result fields and a first version", async () => {
      const { app, modelProviders } = harness();
      const resolveModelForFeature = vi.spyOn(modelProviders, "resolveModelForFeature");

      const created = await app.createWithResolvedDefaults({
        projectId: "project-1",
        name: "Exact",
        type: "code",
        config: program,
        caller: apiKey,
      });

      expect(created).toMatchObject({
        type: "code",
        config: { ...program, outputs: codeEvaluatorOutputFields.map((field) => ({ ...field })) },
      });
      expect(resolveModelForFeature).not.toHaveBeenCalled();
      const { versions } = await app.listVersions({
        projectId: "project-1",
        evaluatorId: created.id,
      });
      expect(versions.map((row) => [row.version, row.authorKind])).toEqual([[1, "api_key"]]);
    });

    /** @scenario A code evaluator created through the API is stored like one the editor saved */
    it("still refuses a config that carries no program", async () => {
      const { app, repository } = harness();
      const create = vi.spyOn(repository, "create");

      await expect(
        app.createWithResolvedDefaults({
          projectId: "project-1",
          name: "Broken",
          type: "code",
          config: { inputs: program.inputs },
        }),
      ).rejects.toMatchObject({ code: "evaluator_config_invalid" });
      expect(create).not.toHaveBeenCalled();
    });
  });

  describe("when the public API creates a workflow evaluator", () => {
    it("links it to the workflow without resolving a model", async () => {
      const { app, modelProviders } = harness();
      const resolveModelForFeature = vi.spyOn(modelProviders, "resolveModelForFeature");

      const created = await app.createWithResolvedDefaults({
        projectId: "project-1",
        name: "Judge",
        type: "workflow",
        config: {},
        workflowId: "workflow-1",
      });

      expect(created).toMatchObject({ type: "workflow", workflowId: "workflow-1" });
      expect(resolveModelForFeature).not.toHaveBeenCalled();
    });

    /** @scenario The public API publishes the wrapped workflow as an evaluator */
    it("flags the workflow as an evaluator and not a component, as the Studio switch does", async () => {
      const setWorkflowFlags = vi.fn(async () => void 0);
      const { app } = createEvaluatorTestApp({ workflows: { setWorkflowFlags } });

      await app.createWithResolvedDefaults({
        projectId: "project-1",
        name: "Judge",
        type: "workflow",
        config: {},
        workflowId: "workflow-1",
      });

      expect(setWorkflowFlags).toHaveBeenCalledWith({
        workflowId: "workflow-1",
        projectId: "project-1",
        isEvaluator: true,
        isComponent: false,
      });
    });

    /** @scenario The public API publishes the wrapped workflow as an evaluator */
    it("leaves the workflow's flags alone when the create is refused", async () => {
      const setWorkflowFlags = vi.fn(async () => void 0);
      const { app } = createEvaluatorTestApp({ workflows: { setWorkflowFlags } });
      const create = {
        projectId: "project-1",
        type: "workflow" as const,
        config: {},
        workflowId: "workflow-1",
      };
      await app.createWithResolvedDefaults({ ...create, name: "Judge" });
      setWorkflowFlags.mockClear();

      await expect(
        app.createWithResolvedDefaults({ ...create, name: "Second judge" }),
      ).rejects.toMatchObject({ code: "evaluator_workflow_evaluator_exists" });

      expect(setWorkflowFlags).not.toHaveBeenCalled();
    });

    /** @scenario The application refuses an evaluator kind that does not match its workflow link */
    it("refuses a workflow evaluator that names no workflow", async () => {
      const { app, repository } = harness();
      const create = vi.spyOn(repository, "create");

      await expect(
        app.createWithResolvedDefaults({
          projectId: "project-1",
          name: "Unlinked",
          type: "workflow",
          config: {},
        }),
      ).rejects.toMatchObject({
        code: "validation_error",
        meta: { fieldErrors: { workflowId: expect.any(Array) } },
      });
      expect(create).not.toHaveBeenCalled();
    });
  });

  describe("when a non-workflow evaluator names a workflow", () => {
    /** @scenario The application refuses an evaluator kind that does not match its workflow link */
    it.each([
      { type: "code" as const, config: runnableCode },
      { type: "evaluator" as const, config: { evaluatorType: "langevals/exact_match" } },
    ])("refuses the $type evaluator before anything is stored", async ({ type, config }) => {
      const { app, repository } = harness();
      const create = vi.spyOn(repository, "create");

      await expect(
        app.createWithResolvedDefaults({
          projectId: "project-1",
          name: "Linked",
          type,
          config,
          workflowId: "workflow-1",
        }),
      ).rejects.toMatchObject({
        code: "validation_error",
        meta: { fieldErrors: { workflowId: expect.any(Array) } },
      });
      expect(create).not.toHaveBeenCalled();
    });
  });

  describe("when a code evaluator carries no program", () => {
    it("refuses the create before the service is reached", async () => {
      const { app, repository } = harness();
      const create = vi.spyOn(repository, "create");

      await expect(
        app.create({
          id: "evaluator_2",
          projectId: "project-1",
          name: "Broken code check",
          type: "code",
          config: { evaluatorType: "code" },
        }),
      ).rejects.toMatchObject({ code: "evaluator_config_invalid" });
      expect(create).not.toHaveBeenCalled();
    });

    it("refuses an update that would leave it without one", async () => {
      const { app, repository } = harness();
      const update = vi.spyOn(repository, "update");

      await expect(
        app.update({
          id: "evaluator_2",
          projectId: "project-1",
          data: { type: "code", config: { evaluatorType: "code" } },
        }),
      ).rejects.toMatchObject({ code: "evaluator_config_invalid" });
      expect(update).not.toHaveBeenCalled();
    });

    it("accepts one that does carry a program", async () => {
      const { app, repository } = harness();
      const create = vi.spyOn(repository, "create");

      await app.create({
        id: "evaluator_2",
        projectId: "project-1",
        name: "Working code check",
        type: "code",
        config: runnableCode,
      });

      expect(create).toHaveBeenCalled();
    });
  });
});

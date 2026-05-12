import { tool } from "ai";
import { z } from "zod";
import { AVAILABLE_EVALUATORS } from "~/server/evaluations/evaluators.generated";
import {
  getEvaluatorDefaultSettings,
  getEvaluatorDefinitions,
} from "~/server/evaluations/getEvaluator";
import type { LangyToolContext } from "./types";

export function makeListEvaluators(ctx: LangyToolContext) {
  return tool({
    description:
      "Lists evaluators available to the caller's project. Returns both the custom project evaluators and the built-in catalog. Use this before suggesting or explaining any evaluator.",
    inputSchema: z.object({
      scope: z
        .enum(["project", "built_in", "all"])
        .default("all")
        .describe(
          "Which set to return: the user's project evaluators, the built-in catalog, or both.",
        ),
    }),
    execute: async ({ scope }) => {
      const items: Array<Record<string, unknown>> = [];

      if (scope === "project" || scope === "all") {
        const projectEvaluators = await ctx.evaluatorService.getAllWithFields({
          projectId: ctx.projectId,
        });
        for (const e of projectEvaluators) {
          ctx.seenIds.record("evaluator_id", e.id);
          ctx.seenIds.record("evaluator_slug", e.slug);
          items.push({
            source: "project",
            id: e.id,
            slug: e.slug,
            name: e.name,
            type: e.type,
            inputs: e.fields.map((f) => f.identifier),
          });
        }
      }

      if (scope === "built_in" || scope === "all") {
        for (const [evaluatorType, def] of Object.entries(
          AVAILABLE_EVALUATORS,
        )) {
          ctx.seenIds.record("evaluator_type", evaluatorType);
          items.push({
            source: "built_in",
            evaluatorType,
            name: def.name,
            description: def.description,
            category: def.category,
            isGuardrail: def.isGuardrail,
            requiredFields: def.requiredFields,
            optionalFields: def.optionalFields,
          });
        }
      }

      return { items };
    },
  });
}

export function makeGetEvaluatorDetails(ctx: LangyToolContext) {
  return tool({
    description:
      "Fetches details for a single evaluator, either by project slug (for custom project evaluators) or by built-in type key (for catalog entries). Provide exactly one of `slug` or `evaluatorType`.",
    inputSchema: z.object({
      slug: z
        .string()
        .optional()
        .describe("Project evaluator slug for custom evaluators."),
      evaluatorType: z
        .string()
        .optional()
        .describe(
          "Built-in evaluator type key, for example 'ragas/answer_relevancy'.",
        ),
    }),
    execute: async ({ slug, evaluatorType }) => {
      if (slug) {
        const evaluator = await ctx.evaluatorService.getBySlug({
          slug,
          projectId: ctx.projectId,
        });
        if (!evaluator) {
          return {
            error: `No project evaluator found with slug '${slug}'.`,
          };
        }
        ctx.seenIds.record("evaluator_id", evaluator.id);
        ctx.seenIds.record("evaluator_slug", evaluator.slug);
        const enriched = await ctx.evaluatorService.enrichWithFields(evaluator);
        return {
          source: "project",
          id: enriched.id,
          slug: enriched.slug,
          name: enriched.name,
          type: enriched.type,
          fields: enriched.fields,
          outputFields: enriched.outputFields,
        };
      }

      if (evaluatorType) {
        const def =
          AVAILABLE_EVALUATORS[
            evaluatorType as keyof typeof AVAILABLE_EVALUATORS
          ];
        if (!def) {
          return {
            error: `No built-in evaluator with type '${evaluatorType}'.`,
          };
        }
        return {
          source: "built_in",
          evaluatorType,
          name: def.name,
          description: def.description,
          category: def.category,
          isGuardrail: def.isGuardrail,
          requiredFields: def.requiredFields,
          optionalFields: def.optionalFields,
          result: def.result,
          docsUrl: def.docsUrl,
        };
      }

      return {
        error: "Provide either 'slug' or 'evaluatorType'.",
      };
    },
  });
}

export function makeProposeCreateEvaluator(ctx: LangyToolContext) {
  return tool({
    description:
      "Propose creating a new evaluator in the project. The user will see a preview card and click Apply to commit. Use this when the user asks for a new evaluator that doesn't yet exist.",
    inputSchema: z.object({
      name: z
        .string()
        .min(1)
        .max(255)
        .describe("Human-readable evaluator name shown in the UI."),
      evaluatorType: z
        .string()
        .describe(
          "The built-in evaluator type key, e.g. 'ragas/answer_relevancy'. Must match one you found via list_evaluators('built_in').",
        ),
      settings: z
        .record(z.unknown())
        .optional()
        .describe(
          "Optional settings override. Leave empty to use defaults from the evaluator definition.",
        ),
      rationale: z
        .string()
        .describe(
          "One short sentence explaining why this evaluator fits the user's goal.",
        ),
    }),
    execute: async ({ name, evaluatorType, settings, rationale }) => {
      if (!ctx.seenIds.has("evaluator_type", evaluatorType)) {
        return {
          error: `Evaluator type '${evaluatorType}' was not surfaced by list_evaluators in this conversation. Call list_evaluators('built_in') and reference one of those types.`,
        };
      }
      const def =
        AVAILABLE_EVALUATORS[evaluatorType as keyof typeof AVAILABLE_EVALUATORS];
      if (!def) {
        return {
          error: `No built-in evaluator with type '${evaluatorType}'. Use list_evaluators('built_in') first.`,
        };
      }
      const project = await ctx.prisma.project.findUnique({
        where: { id: ctx.projectId },
        select: { defaultModel: true, embeddingsModel: true },
      });
      const defaults = getEvaluatorDefaultSettings(
        getEvaluatorDefinitions(evaluatorType),
        project ?? undefined,
      ) as Record<string, unknown>;
      const mergedSettings: Record<string, unknown> = {
        ...defaults,
        ...(settings ?? {}),
      };
      const chosenModel =
        typeof mergedSettings.model === "string"
          ? mergedSettings.model
          : undefined;
      return {
        langyProposal: true,
        kind: "evaluators.create",
        summary: `Create evaluator "${name}" (${evaluatorType})`,
        rationale: chosenModel
          ? `${rationale} Uses ${chosenModel} (project default).`
          : rationale,
        payload: {
          name,
          type: "evaluator" as const,
          config: {
            evaluatorType,
            settings: mergedSettings,
          },
        },
      };
    },
  });
}

export function makeProposeUpdateEvaluator(ctx: LangyToolContext) {
  return tool({
    description:
      "Propose updating an existing project evaluator's name or settings. Call get_evaluator_details first so you only override what you actually want to change. Settings are merged over the evaluator's current config.",
    inputSchema: z.object({
      slug: z.string().describe("Slug of the project evaluator to update."),
      name: z.string().min(1).max(255).optional(),
      settings: z
        .record(z.unknown())
        .optional()
        .describe(
          "Partial settings to merge over the evaluator's current settings object.",
        ),
      rationale: z.string(),
    }),
    execute: async ({ slug, name, settings, rationale }) => {
      if (!ctx.seenIds.has("evaluator_slug", slug)) {
        return {
          error: `Evaluator slug '${slug}' was not surfaced by list_evaluators in this conversation. Call list_evaluators first.`,
        };
      }
      const evaluator = await ctx.evaluatorService.getBySlug({
        slug,
        projectId: ctx.projectId,
      });
      if (!evaluator) {
        return { error: `No project evaluator with slug '${slug}'.` };
      }
      const currentConfig =
        (evaluator.config as Record<string, unknown> | null) ?? {};
      const currentSettings =
        (currentConfig.settings as Record<string, unknown> | undefined) ?? {};
      const mergedConfig: Record<string, unknown> = {
        ...currentConfig,
        ...(settings
          ? { settings: { ...currentSettings, ...settings } }
          : {}),
      };
      const changedFields: string[] = [];
      if (name && name !== evaluator.name) changedFields.push("name");
      if (settings) changedFields.push(...Object.keys(settings));
      return {
        langyProposal: true,
        kind: "evaluators.update",
        summary: `Update evaluator "${evaluator.name}"${
          changedFields.length ? ` (${changedFields.join(", ")})` : ""
        }`,
        rationale,
        payload: {
          id: evaluator.id,
          evaluatorType: (currentConfig as { evaluatorType?: string })
            .evaluatorType,
          ...(name ? { name } : {}),
          config: mergedConfig,
        },
      };
    },
  });
}

export function makeProposeDeleteEvaluator(ctx: LangyToolContext) {
  return tool({
    description:
      "Propose archiving (soft-deleting) an existing project evaluator. This is a destructive action — only propose it when the user explicitly asks. Existing workbench references to this evaluator will break once archived.",
    inputSchema: z.object({
      slug: z.string().describe("Slug of the project evaluator to archive."),
      rationale: z
        .string()
        .describe(
          "Why the user wants to delete this evaluator, or a short confirmation of what they asked.",
        ),
    }),
    execute: async ({ slug, rationale }) => {
      if (!ctx.seenIds.has("evaluator_slug", slug)) {
        return {
          error: `Evaluator slug '${slug}' was not surfaced by list_evaluators in this conversation.`,
        };
      }
      const evaluator = await ctx.evaluatorService.getBySlug({
        slug,
        projectId: ctx.projectId,
      });
      if (!evaluator) {
        return { error: `No project evaluator with slug '${slug}'.` };
      }
      return {
        langyProposal: true,
        kind: "evaluators.delete",
        destructive: true,
        summary: `Archive evaluator "${evaluator.name}"`,
        rationale,
        payload: {
          id: evaluator.id,
          name: evaluator.name,
        },
      };
    },
  });
}

export function makeProposeAddEvaluatorToWorkbench(ctx: LangyToolContext) {
  return tool({
    description:
      "Propose adding an existing project evaluator as a column in the current experiment workbench. Only works for evaluators that already exist in the project (use propose_create_evaluator first if needed).",
    inputSchema: z.object({
      slug: z
        .string()
        .describe("Slug of the existing project evaluator to add."),
      rationale: z.string(),
    }),
    execute: async ({ slug, rationale }) => {
      if (!ctx.seenIds.has("evaluator_slug", slug)) {
        return {
          error: `Evaluator slug '${slug}' was not surfaced by list_evaluators in this conversation.`,
        };
      }
      const evaluator = await ctx.evaluatorService.getBySlug({
        slug,
        projectId: ctx.projectId,
      });
      if (!evaluator) {
        return { error: `No project evaluator with slug '${slug}'.` };
      }
      const enriched = await ctx.evaluatorService.enrichWithFields(evaluator);
      const evalType =
        (enriched.config as { evaluatorType?: string } | null)?.evaluatorType ??
        `custom/${enriched.slug}`;
      return {
        langyProposal: true,
        kind: "workbench.addEvaluator",
        summary: `Add "${enriched.name}" to this workbench`,
        rationale,
        payload: {
          dbEvaluatorId: enriched.id,
          evaluatorType: evalType,
          name: enriched.name,
          fields: enriched.fields,
        },
      };
    },
  });
}

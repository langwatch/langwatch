/**
 * Hono route for the SAGE assistant.
 *
 * POST /api/sage/chat — streams an AI chat response with access to
 * read-only evaluator tools scoped to the caller's project.
 *
 * SAGE = Scenarios, Analysis, Guidance, Evaluation.
 *
 * v1 is read-only: Sage proposes actions, it does not run evaluators,
 * mutate experiments, or modify project state.
 */
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  tool,
  type UIMessage,
} from "ai";
import { Hono } from "hono";
import { z } from "zod";
import { loggerMiddleware } from "~/app/api/middleware/logger";
import { tracerMiddleware } from "~/app/api/middleware/tracer";
import { hasProjectPermission } from "~/server/api/rbac";
import { getServerAuthSession } from "~/server/auth";
import { prisma } from "~/server/db";
import { AVAILABLE_EVALUATORS } from "~/server/evaluations/evaluators.generated";
import {
  getEvaluatorDefaultSettings,
  getEvaluatorDefinitions,
} from "~/server/evaluations/getEvaluator";
import { EvaluatorService } from "~/server/evaluators/evaluator.service";
import { getVercelAIModel } from "~/server/modelProviders/utils";
import { PromptService } from "~/server/prompt-config/prompt.service";
import { createLogger } from "~/utils/logger/server";
import type { NextRequestShim as any } from "./types";

const logger = createLogger("langwatch:api:sage");

const SAGE_MODEL = "openai/gpt-5";

const SAGE_SYSTEM_PROMPT = `You are Sage, the in-product AI assistant for LangWatch. You live in a right-side sidebar inside the experiment workbench. The name stands for Scenarios, Analysis, Guidance, Evaluation.

## What you can do
- **Read** the project's evaluators, prompts, and datasets. Use these tools autonomously whenever they help you answer.
- **Propose changes** that the user can apply with one click — creating evaluators, adding them to the workbench, and (later) prompts/datasets. You never mutate state yourself. Every "propose_*" tool returns a card; the user clicks Apply to commit.

## Ground rules
- Never fabricate names, IDs, or slugs. Only reference entities your tools returned.
- When asked to "do" something, propose it via the relevant propose_* tool. Say "I'll propose this for you to approve" rather than "I did it".
- One proposal per turn unless the user explicitly asked for multiple. Don't spam cards.

## Tone
- Informative, not over-helpful. Curate — do not enumerate.
- "What do I have?" → surface **at most 3–5** most relevant items, grouped by category if useful. Never paste the full catalog.
- Prefer 1–3 short bullets. No filler openers ("Great question!", "Sure!"). No closing offers unless the user is likely to need more.
- If the honest answer needs more than 5 items, summarize + offer drill-down instead of listing everything.
- When recommending, pick the single best match first, then at most two alternatives, each in one line.

## Tool use
- Before talking about the user's evaluators/prompts/datasets, call the matching list_* tool with 'project' scope first.
- Use list_evaluators 'built_in' or 'all' only when suggesting new evaluators from the catalog.
- After a tool call, synthesize — don't regurgitate the raw list.

## Evaluator models
- propose_create_evaluator auto-fills settings from the evaluator's defaults, using the **project's default model** for any \`model\` field. You do NOT need to pass settings.model unless the user explicitly asked for a specific one.
- If the user wants to choose a model, ask them which and then pass it in settings.model when proposing.
- Mention the chosen model briefly in your reply so the user can catch it before applying.`;

export const app = new Hono().basePath("/api");
app.use(tracerMiddleware({ name: "sage" }));
app.use(loggerMiddleware());

app.post("/sage/chat", async (c) => {
  const session = await getServerAuthSession({ req: c.req.raw as any });
  if (!session) {
    return c.json(
      { error: "You must be logged in to access this endpoint." },
      { status: 401 },
    );
  }

  const { messages, projectId } = (await c.req.json()) as {
    messages: UIMessage[];
    projectId: string;
  };

  if (!projectId) {
    return c.json({ error: "Missing projectId" }, { status: 400 });
  }

  const hasPermission = await hasProjectPermission(
    { prisma, session },
    projectId,
    "evaluations:view",
  );
  if (!hasPermission) {
    return c.json(
      { error: "You do not have permission to use Sage for this project." },
      { status: 403 },
    );
  }

  const evaluatorService = EvaluatorService.create(prisma);
  const promptService = new PromptService(prisma);

  const tools = {
    list_evaluators: tool({
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
          const projectEvaluators = await evaluatorService.getAllWithFields({
            projectId,
          });
          for (const e of projectEvaluators) {
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
    }),

    get_evaluator_details: tool({
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
          const evaluator = await evaluatorService.getBySlug({
            slug,
            projectId,
          });
          if (!evaluator) {
            return {
              error: `No project evaluator found with slug '${slug}'.`,
            };
          }
          const enriched = await evaluatorService.enrichWithFields(evaluator);
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
    }),

    list_prompts: tool({
      description:
        "Lists the prompts defined in the caller's project. Returns handle, name, model, and a short preview.",
      inputSchema: z.object({}),
      execute: async () => {
        const prompts = await promptService.getAllPrompts({
          projectId,
          version: "latest",
        });
        return {
          items: prompts.map((p: Record<string, unknown>) => ({
            id: p.id,
            handle: p.handle,
            name: p.name ?? p.handle,
            model: p.model,
            scope: p.scope,
          })),
        };
      },
    }),

    list_datasets: tool({
      description:
        "Lists the datasets in the caller's project with their column schema and row count.",
      inputSchema: z.object({}),
      execute: async () => {
        const datasets = await prisma.dataset.findMany({
          where: { projectId, archivedAt: null },
          orderBy: { updatedAt: "desc" },
          include: { _count: { select: { datasetRecords: true } } },
        });
        return {
          items: datasets.map((d) => ({
            id: d.id,
            slug: d.slug,
            name: d.name,
            columnTypes: d.columnTypes,
            rowCount: d._count.datasetRecords,
          })),
        };
      },
    }),

    propose_create_evaluator: tool({
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
        const def =
          AVAILABLE_EVALUATORS[
            evaluatorType as keyof typeof AVAILABLE_EVALUATORS
          ];
        if (!def) {
          return {
            error: `No built-in evaluator with type '${evaluatorType}'. Use list_evaluators('built_in') first.`,
          };
        }
        const project = await prisma.project.findUnique({
          where: { id: projectId },
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
          sageProposal: true,
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
    }),

    propose_add_evaluator_to_workbench: tool({
      description:
        "Propose adding an existing project evaluator as a column in the current experiment workbench. Only works for evaluators that already exist in the project (use propose_create_evaluator first if needed).",
      inputSchema: z.object({
        slug: z
          .string()
          .describe("Slug of the existing project evaluator to add."),
        rationale: z.string(),
      }),
      execute: async ({ slug, rationale }) => {
        const evaluator = await evaluatorService.getBySlug({
          slug,
          projectId,
        });
        if (!evaluator) {
          return { error: `No project evaluator with slug '${slug}'.` };
        }
        const enriched = await evaluatorService.enrichWithFields(evaluator);
        const evalType =
          (enriched.config as { evaluatorType?: string } | null)
            ?.evaluatorType ?? `custom/${enriched.slug}`;
        return {
          sageProposal: true,
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
    }),
  };

  const model = await getVercelAIModel(projectId, SAGE_MODEL);

  const result = streamText({
    model,
    system: SAGE_SYSTEM_PROMPT,
    messages: convertToModelMessages(messages),
    tools,
    stopWhen: stepCountIs(8),
    maxRetries: 2,
    experimental_telemetry: {
      isEnabled: true,
      functionId: "sage.chat",
      metadata: {
        "langwatch.project_id": projectId,
        "langwatch.user_id": session.user.id,
      },
    },
    onError: (error) => {
      logger.error({ error }, "error in sage chat stream");
    },
  });

  const response = result.toUIMessageStreamResponse();
  return new Response(response.body, {
    status: response.status,
    headers: response.headers,
  });
});

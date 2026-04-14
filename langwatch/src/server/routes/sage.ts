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
import { persistedEvaluationsV3StateSchema } from "~/evaluations-v3/types/persistence";
import { AVAILABLE_EVALUATORS } from "~/server/evaluations/evaluators.generated";
import {
  getEvaluatorDefaultSettings,
  getEvaluatorDefinitions,
} from "~/server/evaluations/getEvaluator";
import { EvaluatorService } from "~/server/evaluators/evaluator.service";
import { getVercelAIModel } from "~/server/modelProviders/utils";
import { PromptService } from "~/server/prompt-config/prompt.service";
import { parseEvaluationResult } from "~/utils/evaluationResults";
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
- When the user asks about "my experiment", "this experiment", the results, or what's configured in the workbench, call **get_workbench_state** first. That tool is authoritative for what's actually on screen.
- To investigate failures or underperformance, use **find_failing_rows**. Report the pattern (what inputs fail, which evaluator flagged them) rather than dumping the raw list.
- Before talking about the user's evaluators/prompts/datasets at the project level (not the workbench), call the matching list_* tool with 'project' scope first.
- Use list_evaluators 'built_in' or 'all' only when suggesting new evaluators from the catalog.
- After a tool call, synthesize — don't regurgitate the raw list.
- Workbench state reflects the last autosave, which usually lags the UI by a second or two. If the user says "I just added X", call get_workbench_state anyway — it'll usually be there.

## Running experiments
- Use **propose_run_workbench** when the user asks to run/evaluate/execute the experiment. Before proposing, call get_workbench_state and sanity-check that there's at least one target and at least one evaluator. If mappings look missing, note that in your reply so the user knows a run might fail validation.

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

  const { messages, projectId, experimentSlug } = (await c.req.json()) as {
    messages: UIMessage[];
    projectId: string;
    experimentSlug?: string;
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

    get_workbench_state: tool({
      description:
        "Inspect the current experiment workbench: what datasets, targets, and evaluators are configured, plus summary statistics from the last run (pass/fail/error counts per target). Call this before answering any question about the current experiment's setup or results.",
      inputSchema: z.object({}),
      execute: async () => {
        if (!experimentSlug) {
          return {
            error:
              "No experiment is currently open. The caller did not pass experimentSlug.",
          };
        }
        const experiment = await prisma.experiment.findFirst({
          where: { projectId, slug: experimentSlug },
        });
        if (!experiment) {
          return { error: `No experiment found with slug '${experimentSlug}'.` };
        }
        if (!experiment.workbenchState) {
          return {
            experimentName: experiment.name ?? experimentSlug,
            message:
              "This experiment has no saved workbench state yet. It hasn't been configured or nothing has autosaved.",
          };
        }
        const parsed = persistedEvaluationsV3StateSchema.safeParse(
          experiment.workbenchState,
        );
        if (!parsed.success) {
          return {
            error: "Failed to parse workbench state.",
            details: parsed.error.message,
          };
        }
        const state = parsed.data;
        return summarizeWorkbenchState(state);
      },
    }),

    find_failing_rows: tool({
      description:
        "Return rows from the current workbench where an evaluator reported a failed or error status. Use this to investigate why an experiment is underperforming. Returns at most `limit` rows with their input values and which evaluators flagged them.",
      inputSchema: z.object({
        evaluatorSlug: z
          .string()
          .optional()
          .describe(
            "Optional: restrict to a single evaluator by its project slug. Omit to scan all evaluators.",
          ),
        targetId: z
          .string()
          .optional()
          .describe("Optional: restrict to a single target id."),
        limit: z.number().int().min(1).max(20).default(10),
      }),
      execute: async ({ evaluatorSlug, targetId, limit }) => {
        if (!experimentSlug) {
          return { error: "No experiment is currently open." };
        }
        const experiment = await prisma.experiment.findFirst({
          where: { projectId, slug: experimentSlug },
        });
        if (!experiment?.workbenchState) {
          return {
            error: `Experiment '${experimentSlug}' has no results yet.`,
          };
        }
        const parsed = persistedEvaluationsV3StateSchema.safeParse(
          experiment.workbenchState,
        );
        if (!parsed.success) {
          return { error: "Failed to parse workbench state." };
        }
        const state = parsed.data;
        let evaluatorIdFilter: string | undefined;
        if (evaluatorSlug) {
          const dbEval = await evaluatorService.getBySlug({
            slug: evaluatorSlug,
            projectId,
          });
          if (!dbEval) {
            return {
              error: `No project evaluator with slug '${evaluatorSlug}'.`,
            };
          }
          const match = state.evaluators.find(
            (e) => e.dbEvaluatorId === dbEval.id,
          );
          if (!match) {
            return {
              error: `Evaluator '${evaluatorSlug}' is not in this workbench.`,
            };
          }
          evaluatorIdFilter = match.id;
        }
        return findFailingRows(state, {
          evaluatorIdFilter,
          targetIdFilter: targetId,
          limit,
        });
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

    propose_run_workbench: tool({
      description:
        "Propose running the current experiment (kicks off all target × evaluator cells). Returns a proposal card the user clicks Apply to execute. Use this when the user asks to 'run', 'evaluate', 'execute', or 'kick off' the experiment.",
      inputSchema: z.object({
        rationale: z
          .string()
          .describe(
            "One short sentence explaining why running now makes sense (e.g. 'all mappings look configured, ready to run').",
          ),
      }),
      execute: async ({ rationale }) => {
        return {
          sageProposal: true,
          kind: "workbench.run",
          summary: "Run the evaluation on all targets and evaluators",
          rationale,
          payload: {},
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

type ParsedState = ReturnType<
  typeof persistedEvaluationsV3StateSchema.parse
>;

function summarizeWorkbenchState(state: ParsedState) {
  const datasets = state.datasets.map((d) => ({
    id: d.id,
    type: d.type,
    columns: (d.columns ?? []).map((c) =>
      typeof c === "string" ? c : (c as { name?: string }).name,
    ),
    ...("datasetId" in d && d.datasetId ? { datasetId: d.datasetId } : {}),
  }));

  const targets = state.targets.map((t) => {
    const local = (t as Record<string, unknown>).localTargetConfig as
      | { name?: string }
      | undefined;
    return {
      id: t.id,
      type: (t as { type?: string }).type,
      name: local?.name ?? t.id,
    };
  });

  const evaluators = state.evaluators.map((e) => ({
    id: e.id,
    evaluatorType: e.evaluatorType,
    name: e.localEvaluatorConfig?.name ?? e.id,
    dbEvaluatorId: e.dbEvaluatorId,
  }));

  const results = state.results
    ? summarizePerTargetResults(state)
    : null;

  return {
    experimentName: state.name,
    activeDatasetId: state.activeDatasetId,
    datasets,
    targets,
    evaluators,
    results,
  };
}

function summarizePerTargetResults(state: ParsedState) {
  const results = state.results;
  if (!results) return null;
  const summary: Array<{
    targetId: string;
    rowsEvaluated: number;
    errors: number;
    perEvaluator: Array<{
      evaluatorId: string;
      evaluatorName: string;
      passed: number;
      failed: number;
      processed: number;
      error: number;
      skipped: number;
      pending: number;
    }>;
  }> = [];
  const evaluatorNameById = Object.fromEntries(
    state.evaluators.map((e) => [e.id, e.localEvaluatorConfig?.name ?? e.id]),
  );
  for (const [targetId, outputs] of Object.entries(results.targetOutputs)) {
    const rowCount = outputs.length;
    const targetErrors = results.errors[targetId] ?? [];
    const errors = targetErrors.filter(Boolean).length;
    const perEvaluator: typeof summary[number]["perEvaluator"] = [];
    const evalResults = results.evaluatorResults[targetId] ?? {};
    for (const [evaluatorId, cells] of Object.entries(evalResults)) {
      const counts = {
        passed: 0,
        failed: 0,
        processed: 0,
        error: 0,
        skipped: 0,
        pending: 0,
      };
      for (let i = 0; i < rowCount; i++) {
        const parsed = parseEvaluationResult(cells[i]);
        if (parsed.status === "running") continue;
        if (parsed.status in counts) {
          counts[parsed.status as keyof typeof counts]++;
        }
      }
      perEvaluator.push({
        evaluatorId,
        evaluatorName: evaluatorNameById[evaluatorId] ?? evaluatorId,
        ...counts,
      });
    }
    summary.push({
      targetId,
      rowsEvaluated: rowCount,
      errors,
      perEvaluator,
    });
  }
  return summary;
}

function findFailingRows(
  state: ParsedState,
  opts: {
    evaluatorIdFilter?: string;
    targetIdFilter?: string;
    limit: number;
  },
) {
  const results = state.results;
  if (!results) return { rows: [], total: 0 };

  const evaluatorNameById = Object.fromEntries(
    state.evaluators.map((e) => [e.id, e.localEvaluatorConfig?.name ?? e.id]),
  );
  const inlineDatasets = Object.fromEntries(
    state.datasets
      .filter((d) => d.type === "inline")
      .map((d) => [d.id, d as { id: string; columns?: unknown; records?: Record<string, unknown[]> }]),
  );

  type FailingRow = {
    targetId: string;
    rowIndex: number;
    inputs?: Record<string, unknown>;
    failingEvaluators: Array<{
      evaluatorId: string;
      evaluatorName: string;
      status: string;
      details?: string;
    }>;
  };
  const rows: FailingRow[] = [];
  let total = 0;

  for (const [targetId, evalResults] of Object.entries(
    results.evaluatorResults,
  )) {
    if (opts.targetIdFilter && targetId !== opts.targetIdFilter) continue;
    const rowCount = results.targetOutputs[targetId]?.length ?? 0;
    for (let i = 0; i < rowCount; i++) {
      const failing: FailingRow["failingEvaluators"] = [];
      for (const [evaluatorId, cells] of Object.entries(evalResults)) {
        if (opts.evaluatorIdFilter && evaluatorId !== opts.evaluatorIdFilter)
          continue;
        const parsed = parseEvaluationResult(cells[i]);
        if (parsed.status === "failed" || parsed.status === "error") {
          failing.push({
            evaluatorId,
            evaluatorName: evaluatorNameById[evaluatorId] ?? evaluatorId,
            status: parsed.status,
            details: parsed.details,
          });
        }
      }
      if (failing.length === 0) continue;
      total++;
      if (rows.length >= opts.limit) continue;
      // Try to attach input values from an inline dataset if available
      const inputs = extractRowInputs(inlineDatasets, i);
      rows.push({ targetId, rowIndex: i, inputs, failingEvaluators: failing });
    }
  }

  return { rows, total };
}

function extractRowInputs(
  inlineDatasets: Record<
    string,
    { records?: Record<string, unknown[]> }
  >,
  rowIndex: number,
): Record<string, unknown> | undefined {
  for (const dataset of Object.values(inlineDatasets)) {
    if (!dataset.records) continue;
    const row: Record<string, unknown> = {};
    let hasAny = false;
    for (const [column, cells] of Object.entries(dataset.records)) {
      if (rowIndex < cells.length) {
        row[column] = cells[rowIndex];
        hasAny = true;
      }
    }
    if (hasAny) return row;
  }
  return undefined;
}

import { z } from "zod";
import { persistedEvaluationsV3StateSchema } from "~/evaluations-v3/types/persistence";
import { parseEvaluationResult } from "~/utils/evaluationResults";
import { defineLangyTool } from "../defineLangyTool";
import type { LangyToolContext } from "./types";

type ParsedState = ReturnType<typeof persistedEvaluationsV3StateSchema.parse>;

export function summarizeWorkbenchState(state: ParsedState) {
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

  const results = state.results ? summarizePerTargetResults(state) : null;

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

export function findFailingRows(
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
      .map((d) => [
        d.id,
        d as {
          id: string;
          columns?: unknown;
          records?: Record<string, unknown[]>;
        },
      ]),
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
      const inputs = extractRowInputs(inlineDatasets, i);
      rows.push({ targetId, rowIndex: i, inputs, failingEvaluators: failing });
    }
  }

  return { rows, total };
}

function extractRowInputs(
  inlineDatasets: Record<string, { records?: Record<string, unknown[]> }>,
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

const workbenchErrorSchema = z.object({
  error: z.string(),
  details: z.string().optional(),
});

const workbenchEmptyStateSchema = z.object({
  experimentName: z.string(),
  message: z.string(),
});

const workbenchSummarySchema = z.object({
  experimentName: z.string(),
  activeDatasetId: z.string().nullable().optional(),
  datasets: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      columns: z.array(z.string().optional()),
      datasetId: z.string().optional(),
    }),
  ),
  targets: z.array(
    z.object({
      id: z.string(),
      type: z.string().optional(),
      name: z.string(),
    }),
  ),
  evaluators: z.array(
    z.object({
      id: z.string(),
      evaluatorType: z.string(),
      name: z.string(),
      dbEvaluatorId: z.string().nullable().optional(),
    }),
  ),
  results: z
    .array(
      z.object({
        targetId: z.string(),
        rowsEvaluated: z.number(),
        errors: z.number(),
        perEvaluator: z.array(
          z.object({
            evaluatorId: z.string(),
            evaluatorName: z.string(),
            passed: z.number(),
            failed: z.number(),
            processed: z.number(),
            error: z.number(),
            skipped: z.number(),
            pending: z.number(),
          }),
        ),
      }),
    )
    .nullable(),
});

export function makeGetWorkbenchState(ctx: LangyToolContext) {
  return defineLangyTool({
    name: "get_workbench_state",
    description:
      "Inspect the current experiment workbench: what datasets, targets, and evaluators are configured, plus summary statistics from the last run (pass/fail/error counts per target). Call this before answering any question about the current experiment's setup or results.",
    inputSchema: z.object({}),
    outputSchema: z.union([
      workbenchErrorSchema,
      workbenchEmptyStateSchema,
      workbenchSummarySchema,
    ]),
    execute: async () => {
      if (!ctx.experimentSlug) {
        return {
          error:
            "No experiment is currently open. The caller did not pass experimentSlug.",
        };
      }
      const experiment = await ctx.prisma.experiment.findFirst({
        where: { projectId: ctx.projectId, slug: ctx.experimentSlug },
      });
      if (!experiment) {
        return {
          error: `No experiment found with slug '${ctx.experimentSlug}'.`,
        };
      }
      if (!experiment.workbenchState) {
        return {
          experimentName: experiment.name ?? ctx.experimentSlug,
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
      return summarizeWorkbenchState(parsed.data);
    },
  });
}

const failingRowsSchema = z.object({
  rows: z.array(
    z.object({
      targetId: z.string(),
      rowIndex: z.number(),
      inputs: z.record(z.string(), z.unknown()).optional(),
      failingEvaluators: z.array(
        z.object({
          evaluatorId: z.string(),
          evaluatorName: z.string(),
          status: z.string(),
          details: z.string().optional(),
        }),
      ),
    }),
  ),
  total: z.number(),
});

export function makeFindFailingRows(ctx: LangyToolContext) {
  return defineLangyTool({
    name: "find_failing_rows",
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
    outputSchema: z.union([workbenchErrorSchema, failingRowsSchema]),
    execute: async ({ evaluatorSlug, targetId, limit }) => {
      if (!ctx.experimentSlug) {
        return { error: "No experiment is currently open." };
      }
      const experiment = await ctx.prisma.experiment.findFirst({
        where: { projectId: ctx.projectId, slug: ctx.experimentSlug },
      });
      if (!experiment?.workbenchState) {
        return {
          error: `Experiment '${ctx.experimentSlug}' has no results yet.`,
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
        const dbEval = await ctx.evaluatorService.getBySlug({
          slug: evaluatorSlug,
          projectId: ctx.projectId,
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
  });
}

const workbenchRunProposalSchema = z.object({
  langyProposal: z.literal(true),
  kind: z.literal("workbench.run"),
  summary: z.string(),
  rationale: z.string(),
  payload: z.object({}),
});

export function makeProposeRunWorkbench(_ctx: LangyToolContext) {
  return defineLangyTool({
    name: "propose_run_workbench",
    description:
      "Propose running the current experiment (kicks off all target × evaluator cells). Returns a proposal card the user clicks Apply to execute. Use this when the user asks to 'run', 'evaluate', 'execute', or 'kick off' the experiment.",
    inputSchema: z.object({
      rationale: z
        .string()
        .describe(
          "One short sentence explaining why running now makes sense (e.g. 'all mappings look configured, ready to run').",
        ),
    }),
    outputSchema: workbenchRunProposalSchema,
    execute: async ({ rationale }) => {
      return {
        langyProposal: true as const,
        kind: "workbench.run" as const,
        summary: "Run the evaluation on all targets and evaluators",
        rationale,
        payload: {},
      };
    },
  });
}

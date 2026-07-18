import chalk from "chalk";
import { createSpinner } from "../utils/spinner";
import { checkApiKey } from "../utils/apiKey";
import {
  createLangWatchApiClient,
} from "@/internal/api/client";
import { buildAuthHeaders, isPersonalAccessToken } from "@/internal/api/auth";
import { formatApiErrorMessage } from "@/client-sdk/services/_shared/format-api-error";
import { resolveControlPlaneUrl } from "@/cli/utils/governance/resolveEndpoint";
import { printResult, type RawOutputFlags } from "../utils/output";
import { buildProgram } from "../program";
import { buildCatalog, renderStatusSummary } from "../utils/commandCatalog";
import { TracesApiService } from "@/client-sdk/services/traces/traces-api.service";
import { ExperimentsApiService } from "@/client-sdk/services/experiments/experiments-api.service";
import { GatewayBudgetsApiService } from "@/client-sdk/services/gateway-budgets/gateway-budgets-api.service";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Budgets at or above this utilization are worth a human's attention. */
const BUDGET_ATTENTION_THRESHOLD_PCT = 80;
/** Running state is per-RUN and runs list per experiment, so the "is anything
 * still running" check only re-queries the most recently active experiments. */
const RUNNING_EXPERIMENT_CANDIDATES = 5;

export interface RunningExperiment {
  slug: string;
  name: string | null;
  runId: string;
  progress: number | null;
  total: number | null;
}

export interface BudgetAtRisk {
  name: string;
  scope: string;
  window: string;
  utilizationPct: number;
  spentUsd: string;
  limitUsd: string;
  onBreach: string;
}

/**
 * The "what needs my attention" half of the status document. Each section is
 * independent: a section that fails (no gateway access → 403 on budgets, a
 * backend hiccup on trace search) sets its field to `null` and records WHY in
 * `errors`, and never breaks the rest of status.
 *
 * Monitors are deliberately absent: the monitors REST surface
 * (`GET /api/monitors`) exposes configuration only — no firing/health state —
 * so there is nothing cheap and honest to report here. (Firing state lives in
 * ClickHouse evaluation results, which the API does not expose as a count.)
 */
export interface AttentionReport {
  erroredTraces24h: number | null;
  runningExperiments: RunningExperiment[] | null;
  budgetsAtRisk: BudgetAtRisk[] | null;
  /** Section key → why it could not be fetched. Empty when everything worked. */
  errors: Record<string, string>;
}

export interface StatusDocument {
  attention: AttentionReport;
  resources: Record<string, { count: number; error?: string; status?: number }>;
}

export const statusCommand = async (options?: RawOutputFlags): Promise<void> => {
  checkApiKey();

  const apiClient = createLangWatchApiClient();
  const apiKey = process.env.LANGWATCH_API_KEY ?? "";
  const endpoint = resolveControlPlaneUrl();
  const spinner = createSpinner("Fetching project status...").start();

  const results: Record<string, { count: number; error?: string; status?: number }> = {};
  const attention: AttentionReport = {
    erroredTraces24h: null,
    runningExperiments: null,
    budgetsAtRisk: null,
    errors: {},
  };

  async function fetchCount(url: string): Promise<{ data: unknown; error?: unknown; status?: number }> {
    const response = await fetch(`${endpoint}${url}`, {
      headers: buildAuthHeaders({ apiKey }),
    });
    if (!response.ok) {
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        body = undefined;
      }
      return { data: null, error: body ?? response.statusText, status: response.status };
    }
    const data = await response.json();
    return { data, error: undefined };
  }

  // ── Attention-section fetchers ──────────────────────────────────────
  // Each one is soft-fail: it either returns its section value or throws, and
  // the allSettled below turns a throw into an `errors` entry.

  async function fetchErroredTraces24h(): Promise<number> {
    const now = Date.now();
    // Only the count matters — one trace back is enough to read totalHits.
    const result = await new TracesApiService().search({
      startDate: now - DAY_MS,
      endDate: now,
      pageSize: 1,
      format: "json",
      filters: { "traces.error": ["true"] },
    });
    return result.pagination.totalHits;
  }

  async function fetchRunningExperiments(): Promise<RunningExperiment[]> {
    const service = new ExperimentsApiService();
    const list = await service.listExperiments({ pageSize: 50 });
    // "Running" is a property of a run, and runs are only listed per
    // experiment — so check the latest run of just the most recently active
    // experiments rather than fanning out over all of them.
    const candidates = list.experiments
      .filter(
        (experiment) =>
          experiment.lastRunAt !== null &&
          Date.now() - new Date(experiment.lastRunAt).getTime() < DAY_MS,
      )
      .sort(
        (a, b) =>
          new Date(b.lastRunAt ?? 0).getTime() - new Date(a.lastRunAt ?? 0).getTime(),
      )
      .slice(0, RUNNING_EXPERIMENT_CANDIDATES);

    const checks = await Promise.allSettled(
      candidates.map(async (experiment): Promise<RunningExperiment | null> => {
        const runs = await service.listRuns({
          experimentSlug: experiment.slug,
          pageSize: 1,
        });
        const latest = runs.runs[0];
        if (!latest) return null;
        const { finishedAt, stoppedAt } = latest.timestamps;
        if (finishedAt != null || stoppedAt != null) return null;
        return {
          slug: experiment.slug,
          name: experiment.name,
          runId: latest.runId,
          progress: latest.progress ?? null,
          total: latest.total ?? null,
        };
      }),
    );
    // A candidate whose run-list call failed is skipped (not reported as
    // running, not as failed) — the section itself only fails when the
    // experiment LIST call failed.
    return checks.flatMap((check) =>
      check.status === "fulfilled" && check.value !== null ? [check.value] : [],
    );
  }

  async function fetchBudgetsAtRisk(): Promise<BudgetAtRisk[]> {
    const budgets = await new GatewayBudgetsApiService({ endpoint, apiKey }).list();
    return budgets
      .filter((budget) => budget.archived_at === null)
      .map((budget) => {
        const limit = Number(budget.limit_usd);
        const spent = Number(budget.spent_usd);
        return {
          name: budget.name,
          scope: budget.scope_type,
          window: budget.window,
          utilizationPct:
            Number.isFinite(limit) && limit > 0 && Number.isFinite(spent)
              ? Math.round((spent / limit) * 100)
              : 0,
          spentUsd: budget.spent_usd,
          limitUsd: budget.limit_usd,
          onBreach: budget.on_breach,
        };
      })
      .filter((budget) => budget.utilizationPct >= BUDGET_ATTENTION_THRESHOLD_PCT)
      .sort((a, b) => b.utilizationPct - a.utilizationPct);
  }

  // Fetch counts for all major resources in parallel
  const fetchers = [
    { key: "evaluators", fn: () => apiClient.GET("/api/evaluators") },
    { key: "scenarios", fn: () => apiClient.GET("/api/scenarios") },
    { key: "suites", fn: () => fetchCount("/api/suites") },
    { key: "datasets", fn: () => apiClient.GET("/api/dataset") },
    { key: "agents", fn: () => apiClient.GET("/api/agents") },
    { key: "workflows", fn: () => apiClient.GET("/api/workflows") },
    { key: "dashboards", fn: () => apiClient.GET("/api/dashboards") },
    { key: "triggers", fn: () => fetchCount("/api/triggers") },
    { key: "monitors", fn: () => fetchCount("/api/monitors") },
    { key: "secrets", fn: () => fetchCount("/api/secrets") },
  ];

  const sectionFetchers = [
    { key: "erroredTraces24h", fn: fetchErroredTraces24h },
    { key: "runningExperiments", fn: fetchRunningExperiments },
    { key: "budgetsAtRisk", fn: fetchBudgetsAtRisk },
  ] as const;

  await Promise.allSettled([
    ...fetchers.map(async ({ key, fn }) => {
      try {
        const result = await fn();
        const { data, error } = result;
        const status = (result as { status?: number; response?: { status?: number } }).status
          ?? (result as { response?: { status?: number } }).response?.status;
        if (error) {
          results[key] = {
            count: 0,
            error: formatApiErrorMessage({ error, options: { status } }),
            status,
          };
          return;
        }
        if (Array.isArray(data)) {
          results[key] = { count: data.length };
        } else if (data && typeof data === "object" && "data" in (data as Record<string, unknown>)) {
          const arr = (data as { data: unknown[] }).data;
          results[key] = { count: Array.isArray(arr) ? arr.length : 0 };
        } else if (data && typeof data === "object" && "pagination" in (data as Record<string, unknown>)) {
          const pagination = (data as { pagination: { total: number } }).pagination;
          results[key] = { count: pagination.total };
        } else {
          results[key] = { count: 0 };
        }
      } catch (err) {
        results[key] = { count: 0, error: formatApiErrorMessage({ error: err }) };
      }
    }),
    ...sectionFetchers.map(async ({ key, fn }) => {
      try {
        // The three section fetchers return number | RunningExperiment[] |
        // BudgetAtRisk[]; the AttentionReport field types line up by key.
        (attention as unknown as Record<string, unknown>)[key] = await fn();
      } catch (err) {
        // Soft-fail: the section reads null and the reason lives in `errors`
        // (rendered dimly in human mode, verbatim in machine output).
        attention.errors[key] = formatApiErrorMessage({ error: err });
      }
    }),
  ]);

  const errorCount = Object.values(results).filter((r) => r.error).length;
  const totalCount = Object.values(results).length;

  if (errorCount === totalCount && totalCount > 0) {
    spinner.fail("Project status — all resource fetches failed");
  } else {
    spinner.succeed("Project status");
  }

  const document: StatusDocument = { attention, resources: results };

  await printResult(document, {
    ...options,
    table: () => {
      // If every resource failed — likely auth/endpoint/server issue. Show a
      // clear diagnostic so the user knows what to check instead of puzzling
      // over a grid of red error messages. (Machine formats print the document
      // and exit 0 — the per-resource errors are IN the document.)
      if (errorCount === totalCount && totalCount > 0) {
        const sampleError = Object.values(results).find((r) => r.error)?.error ?? "";
        const statuses = Object.values(results)
          .map((r) => r.status)
          .filter((s): s is number => typeof s === "number");
        const allUnauthorized = statuses.length > 0 && statuses.every((s) => s === 401 || s === 403);
        console.log();
        console.log(chalk.red("  ✗ Could not fetch any project resources."));
        console.log(chalk.gray(`    Reason: ${sampleError}`));
        console.log();
        if (allUnauthorized && isPersonalAccessToken(apiKey) && !process.env.LANGWATCH_PROJECT_ID) {
          console.log(chalk.gray(`    Your PAT requires ${chalk.cyan("LANGWATCH_PROJECT_ID")} to be set.`));
          console.log(chalk.gray(`    Set it via: ${chalk.cyan("export LANGWATCH_PROJECT_ID=<your-project-id>")}`));
          console.log(chalk.gray(`    Or add to .env: ${chalk.cyan("LANGWATCH_PROJECT_ID=<your-project-id>")}`));
        } else if (allUnauthorized) {
          console.log(chalk.gray(`    Your API key appears to be invalid or revoked. Re-run ${chalk.cyan("langwatch login")} or check ${chalk.cyan("LANGWATCH_API_KEY")}.`));
        } else {
          console.log(chalk.gray(`    Check ${chalk.cyan("LANGWATCH_API_KEY")} (current endpoint: ${chalk.cyan(endpoint)}).`));
        }
        console.log();
        process.exit(1);
      }

      // ── What needs attention (gh-status style) ─────────────────────
      console.log();
      console.log(chalk.bold("  Needs Attention:"));

      let flagged = 0;
      if (attention.erroredTraces24h !== null && attention.erroredTraces24h > 0) {
        flagged++;
        console.log(
          chalk.red(
            `    ⚠ ${attention.erroredTraces24h} trace${attention.erroredTraces24h === 1 ? "" : "s"} errored in the last 24h`,
          ) + chalk.gray(`  →  langwatch trace search  (defaults to the last 24h)`),
        );
      }
      for (const experiment of attention.runningExperiments ?? []) {
        flagged++;
        const progress =
          experiment.progress !== null && experiment.total !== null
            ? ` (${experiment.progress}/${experiment.total})`
            : "";
        console.log(
          chalk.yellow(
            `    ⚠ experiment "${experiment.name ?? experiment.slug}" is still running${progress}`,
          ) + chalk.gray(`  →  langwatch experiment status ${experiment.slug} --run-id ${experiment.runId}`),
        );
      }
      for (const budget of attention.budgetsAtRisk ?? []) {
        flagged++;
        const breached = budget.utilizationPct >= 100;
        const line = `    ⚠ budget "${budget.name}" (${budget.window.toLowerCase()}, ${budget.scope.toLowerCase()}) at ${budget.utilizationPct}% — $${budget.spentUsd} of $${budget.limitUsd}${budget.onBreach === "BLOCK" ? ", blocks on breach" : ""}`;
        console.log(
          (breached ? chalk.red(line) : chalk.yellow(line)) +
            chalk.gray(`  →  langwatch gateway-budgets list`),
        );
      }
      if (flagged === 0) {
        // All-clear only means something when every section actually loaded —
        // don't print a green ✓ next to a list of sections we couldn't check.
        if (Object.keys(attention.errors).length === 0) {
          console.log(chalk.green("    ✓ nothing needs your attention"));
        } else {
          console.log(
            chalk.gray("    – nothing flagged, but some checks did not run"),
          );
        }
      }
      // Sections that could not be fetched are noted dimly, never fatal.
      const sectionLabels: Record<string, string> = {
        erroredTraces24h: "errored traces",
        runningExperiments: "running experiments",
        budgetsAtRisk: "gateway budgets",
      };
      for (const [key, message] of Object.entries(attention.errors)) {
        console.log(chalk.gray(`    (could not check ${sectionLabels[key] ?? key}: ${message})`));
      }

      console.log();
      console.log(chalk.bold("  Resource Counts:"));

      const order = ["evaluators", "scenarios", "suites", "datasets", "agents", "workflows", "dashboards", "triggers", "monitors", "secrets"];
      for (const key of order) {
        const r = results[key];
        if (!r) continue;
        const countStr = r.error
          ? chalk.red(r.error)
          : chalk.cyan(String(r.count));
        console.log(`    ${chalk.gray(key + ":")} ${" ".repeat(14 - key.length)}${countStr}`);
      }

      console.log();
      console.log(chalk.gray("  Available CLI commands:"));
      // Generated from the live command tree (same catalog builder behind
      // `langwatch commands` / `langwatch help-tree`) — no hand-maintained
      // list to drift from what the CLI actually registers.
      for (const line of renderStatusSummary(buildCatalog(buildProgram()))) {
        console.log(chalk.gray(`    ${line}`));
      }
      console.log();
      console.log(chalk.gray("  Run `langwatch commands` for the full catalog (args, flags, hints)."));
      console.log();
    },
  });
};

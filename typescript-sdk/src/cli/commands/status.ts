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
/** How many experiments the first page can carry. Anything past this is unseen
 * by the running-experiments scan and must be declared as a gap. */
const EXPERIMENT_PAGE_SIZE = 50;
/** Per-call ceiling for the cheap resource LIST endpoints. These are indexed
 * Postgres reads behind a single page; anything past a few seconds is a real
 * problem, not load. */
const LIST_CALL_TIMEOUT_MS = 5_000;
/** Per-call ceiling for the attention sections. `fetchErroredTraces24h` is a
 * ClickHouse COUNT over a 24h partition and `fetchRunningExperiments` fans out
 * to N run-list calls — 5-15s is routine on a busy project, so a 5s ceiling
 * would report "timed out" about a perfectly healthy backend. 30s is still far
 * below "blocks the session", while leaving genuine hangs bounded. */
const SECTION_CALL_TIMEOUT_MS = 30_000;

/** The resource rows status fetches, in display order. Single source of truth
 * for both the fetcher table's key type and the rendering order below. */
const RESOURCE_KEYS = [
  "evaluators",
  "scenarios",
  "suites",
  "datasets",
  "agents",
  "workflows",
  "dashboards",
  "triggers",
  "monitors",
  "secrets",
] as const;
type ResourceKey = (typeof RESOURCE_KEYS)[number];

/** The attention sections, which are exactly the non-map fields of
 * `AttentionReport` — so a typo'd key cannot write a junk field onto it. */
type AttentionSectionKey = keyof Omit<AttentionReport, "errors" | "advisories">;

class CallTimeoutError extends Error {
  constructor(ms: number) {
    super(`timed out after ${Math.round(ms / 1000)}s`);
    this.name = "CallTimeoutError";
  }
}

/**
 * Puts a hard floor under every network call status makes.
 *
 * `Promise.allSettled` never rejects, so without this there is no upper bound
 * on how long status blocks: the trace-search POST runs a ClickHouse COUNT over
 * a 24h partition and can hang indefinitely, and a hung call would simply never
 * settle. A timeout is reported the same way any other section failure is —
 * as an `errors` entry — so it withholds the all-clear rather than hiding.
 */
async function withTimeout<T>(operation: () => Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new CallTimeoutError(ms)), ms);
        // Never hold the process open just to fire a timeout that no longer matters.
        (timer as { unref?: () => void }).unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** A timeout is a first-class, self-explanatory reason — don't run it through
 * the API-body formatter, which has nothing to add to it. */
const describeFailure = (error: unknown): string =>
  error instanceof CallTimeoutError ? error.message : formatApiErrorMessage({ error });

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
  /** Section key → why it could not be fetched, or was only partially checked.
   * Empty when everything worked — the green all-clear keys off this. */
  errors: Record<string, string>;
  /** Section key → a scope this API structurally cannot cover, on any project,
   * however healthy. Told to the user, but deliberately NOT gating the
   * all-clear: a permanent caveat that suppresses the tick forever is as
   * useless as a tick that lies, and trains the reader to ignore the section. */
  advisories: Record<string, string>;
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
    advisories: {},
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
    const list = await service.listExperiments({ pageSize: EXPERIMENT_PAGE_SIZE });
    // "Running" is a property of a run, and runs are only listed per
    // experiment — so check the latest run of just the most recently active
    // experiments rather than fanning out over all of them.
    //
    // Deliberately NOT windowed to the last 24h. `running` has no bounded
    // duration: an experiment wedged in `running` for three days has a 72h-old
    // `lastRunAt`, and those are precisely the ones worth surfacing. Recency is
    // used to RANK candidates, never to filter them out.
    const recent = list.experiments
      .filter((experiment) => experiment.lastRunAt !== null)
      .sort(
        (a, b) =>
          new Date(b.lastRunAt ?? 0).getTime() - new Date(a.lastRunAt ?? 0).getTime(),
      );
    const candidates = recent.slice(0, RUNNING_EXPERIMENT_CANDIDATES);

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

    // This scan is inherently PARTIAL (capped candidates, and only the first
    // page of experiments). Whatever was found is still worth reporting, but
    // the gaps must be on the record too: silently dropping them is how a
    // running experiment the scan never looked at turns into a green
    // "nothing needs your attention".
    const failedChecks = checks.filter((check) => check.status === "rejected").length;
    const gaps: string[] = [];
    // `GET /api/experiments` is ordered by `updatedAt desc`, NOT by `lastRunAt`
    // — so a running experiment whose row has a stale `updatedAt` can sit past
    // the page boundary and never be seen at all. An unread page is the single
    // biggest hole in this scan; it goes on the record first.
    if (list.pagination.hasMore) {
      gaps.push(
        `only the first ${list.experiments.length} of ${list.pagination.totalHits} experiments were listed`,
      );
    }
    const running = checks.flatMap((check) =>
      check.status === "fulfilled" && check.value !== null ? [check.value] : [],
    );
    // Only a gap when the cap plausibly HID something. Every experiment that
    // ever ran has a non-null `lastRunAt`, so "there are more than 5 of them"
    // describes almost every real project and would suppress the all-clear
    // permanently. The candidates are ranked most-recently-active first: if
    // every one we checked came back finished, the older, less-recently-active
    // tail behind them is not evidence of anything running. It is only when the
    // sample itself turned up a live run that the cap is hiding a population we
    // have concrete reason to believe contains more.
    if (running.length > 0 && recent.length > candidates.length) {
      gaps.push(
        `only the ${RUNNING_EXPERIMENT_CANDIDATES} most recently active of ${recent.length} candidate experiments were checked`,
      );
    }
    if (failedChecks > 0) {
      gaps.push(
        `${failedChecks} experiment${failedChecks === 1 ? "" : "s"} could not be checked`,
      );
    }
    if (gaps.length > 0) {
      attention.errors.runningExperiments = `incomplete scan: ${gaps.join("; ")}`;
    }

    return running;
  }

  /**
   * `GET /api/gateway/v1/budgets` returns org-, team- and project-scoped
   * budgets only — it documents that VK- and principal-scoped budgets come from
   * "their detail pages", and no REST endpoint serves those: the org-wide
   * listing that does include every scope is a session-authenticated tRPC
   * procedure, the virtual-key DTO carries no budget fields, and there is no
   * `GET /budgets/:id`. So a virtual-key budget at 100% with `on_breach: BLOCK`
   * — actively rejecting production traffic — is structurally invisible here.
   *
   * That blind spot only has anything behind it if this project routes through
   * the gateway at all: with no virtual keys there is no VK or principal
   * traffic to block, and the scopes we CAN see are the whole picture. So probe
   * for keys, and whenever there are any, put the uncovered scope on the
   * record.
   *
   * But record it as an ADVISORY, not an error. It is not a failed check and
   * not something the user can fix: any project that routes through the gateway
   * would carry it on every single run, and an error that never clears is an
   * error the reader learns to skip. A failed PROBE is different — that IS a
   * check that did not run, so it stays an error and withholds the tick.
   */
  async function uncoveredBudgetScopeGap(): Promise<
    { kind: "error" | "advisory"; message: string } | null
  > {
    const unchecked = "virtual-key and principal budgets were not checked";
    let payload: unknown;
    try {
      const { data, error, status } = await fetchCount("/api/gateway/v1/virtual-keys");
      if (error) {
        return {
          kind: "error",
          message: `${unchecked} (could not list virtual keys: ${formatApiErrorMessage({ error, options: { status } })})`,
        };
      }
      payload = data;
    } catch (err) {
      return {
        kind: "error",
        message: `${unchecked} (could not list virtual keys: ${describeFailure(err)})`,
      };
    }
    const body = payload as { data?: unknown; pagination?: { totalHits?: number } } | null;
    const keys = Array.isArray(payload) ? payload : body?.data;
    if (!Array.isArray(keys) || keys.length === 0) return null;
    // The page-1 length is NOT the key count — 300 keys behind pagination would
    // print "3". Use the reported total when there is one, and otherwise say
    // nothing numeric rather than something false.
    const total = body?.pagination?.totalHits;
    const scale =
      typeof total === "number"
        ? `${total} virtual key${total === 1 ? "" : "s"} in this project could`
        : "virtual keys in this project could";
    return {
      kind: "advisory",
      message: `${unchecked} — this API cannot list them, and ${scale} carry them`,
    };
  }

  async function fetchBudgetsAtRisk(): Promise<BudgetAtRisk[]> {
    const [budgets, scopeGap] = await Promise.all([
      new GatewayBudgetsApiService({ endpoint, apiKey }).list(),
      uncoveredBudgetScopeGap(),
    ]);

    const unreadable: string[] = [];
    const scored = budgets
      .filter((budget) => budget.archived_at === null)
      .flatMap((budget): BudgetAtRisk[] => {
        const limit = Number(budget.limit_usd);
        const spent = Number(budget.spent_usd);
        // Neither "at risk" nor "fine" — we cannot say which, so say that.
        if (!Number.isFinite(limit) || !Number.isFinite(spent)) {
          unreadable.push(budget.name);
          return [];
        }
        return [
          {
            name: budget.name,
            scope: budget.scope_type,
            window: budget.window,
            // A limit of zero admits no spend at all: it is the maximally
            // breached state, not a 0%-utilized one. Scoring it 0 and dropping
            // it below the threshold is how a BLOCK budget that rejects every
            // single request turns into a green tick.
            utilizationPct: limit <= 0 ? 100 : Math.round((spent / limit) * 100),
            spentUsd: budget.spent_usd,
            limitUsd: budget.limit_usd,
            onBreach: budget.on_breach,
          },
        ];
      });

    const gaps: string[] = [];
    if (scopeGap?.kind === "advisory") {
      attention.advisories.budgetsAtRisk = scopeGap.message;
    } else if (scopeGap) {
      gaps.push(scopeGap.message);
    }
    if (unreadable.length > 0) {
      gaps.push(
        `the limit or spend of ${unreadable.length} budget${unreadable.length === 1 ? "" : "s"} could not be read (${unreadable.join(", ")})`,
      );
    }
    if (gaps.length > 0) {
      attention.errors.budgetsAtRisk = `incomplete scan: ${gaps.join("; ")}`;
    }

    return scored
      .filter((budget) => budget.utilizationPct >= BUDGET_ATTENTION_THRESHOLD_PCT)
      .sort((a, b) => b.utilizationPct - a.utilizationPct);
  }

  // Fetch counts for all major resources in parallel.
  //
  // Annotated rather than inferred: the array mixes `apiClient.GET` (whose
  // FetchResponse is a DIFFERENT structural type per path) with `fetchCount`,
  // so an inferred `fn` is a union of thunks that `withTimeout<T>` cannot
  // unify. This is the shape the counting below actually reads.
  // The annotation is what pins `fn` (see above), but `keyof typeof results` on
  // a `Record<string, …>` is just `string` — it looks like key safety and isn't,
  // so a typo'd key type-checks and emits a bogus row. Spell the keys out.
  const fetchers: {
    key: ResourceKey;
    fn: () => Promise<{
      data?: unknown;
      error?: unknown;
      status?: number;
      response?: { status?: number };
    }>;
  }[] = [
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

  // Same reason as `fetchers` above: the three return number |
  // RunningExperiment[] | BudgetAtRisk[], so an inferred `fn` is a union of
  // thunks. The result is assigned through a keyed cast below, which is where
  // the per-key types are reconciled.
  const sectionFetchers: { key: AttentionSectionKey; fn: () => Promise<unknown> }[] = [
    { key: "erroredTraces24h", fn: fetchErroredTraces24h },
    { key: "runningExperiments", fn: fetchRunningExperiments },
    { key: "budgetsAtRisk", fn: fetchBudgetsAtRisk },
  ];

  await Promise.allSettled([
    ...fetchers.map(async ({ key, fn }) => {
      try {
        const result = await withTimeout(fn, LIST_CALL_TIMEOUT_MS);
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
        results[key] = { count: 0, error: describeFailure(err) };
      }
    }),
    ...sectionFetchers.map(async ({ key, fn }) => {
      try {
        // The three section fetchers return number | RunningExperiment[] |
        // BudgetAtRisk[]; the AttentionReport field types line up by key.
        (attention as unknown as Record<AttentionSectionKey, unknown>)[key] =
          await withTimeout(fn, SECTION_CALL_TIMEOUT_MS);
      } catch (err) {
        // Soft-fail: the section reads null and the reason lives in `errors`
        // (rendered dimly in human mode, verbatim in machine output). A timeout
        // lands here too, so a hung backend withholds the all-clear like any
        // other unfinished check.
        attention.errors[key] = describeFailure(err);
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
        // All-clear only means something when the whole scan actually ran —
        // don't print a green ✓ next to a list of sections we couldn't check,
        // and don't print one directly above a grid of red 403s either. A
        // resource we could not read is a resource we cannot vouch for.
        if (Object.keys(attention.errors).length === 0 && errorCount === 0) {
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
      // Advisories read differently on purpose: "note" is a standing limit of
      // the API, not a check that failed this run, and it does not gate the ✓.
      for (const [key, message] of Object.entries(attention.advisories)) {
        console.log(chalk.gray(`    (note — ${sectionLabels[key] ?? key}: ${message})`));
      }

      console.log();
      console.log(chalk.bold("  Resource Counts:"));

      for (const key of RESOURCE_KEYS) {
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

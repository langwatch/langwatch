import chalk from "chalk";
import type { Ora } from "ora";

import { resolveControlPlaneUrl } from "@/cli/utils/governance/resolveEndpoint";
import { buildAuthHeaders } from "@/internal/api/auth";
import { scopedApiKey } from "@/internal/credentialContext";
import { langwatchFetch } from "@/internal/http/langwatchFetch";

import { resolveCredentials } from "../../utils/apiKey.ts";
import { readFetchFailure } from "../../utils/formatFetchError.ts";
import { formatRelativeTime } from "../../utils/formatting.ts";
import type { CommandResult } from "../../utils/output.ts";
import { createSpinner } from "../../utils/spinner.ts";
import { failSpinner } from "../../utils/spinnerError.ts";

type SimulationRunListItem = {
  scenarioRunId: string;
  scenarioId: string;
  batchRunId: string;
  name: string | null;
  status: string;
  durationInMs: number;
  totalCost?: number;
  timestamp?: number;
  updatedAt?: number;
  note?: string | null;
  scenarioVersion?: number | null;
  results?: {
    verdict?: string | null;
  } | null;
};

type SimulationRunListPage = {
  runs: SimulationRunListItem[];
  hasMore?: boolean;
  nextCursor?: string;
};

/**
 * The listing pages by batch, so one page can hold no run that matches a status or name
 * filter while later pages do.
 */
const FILTER_SCAN_RUN_CEILING = 500;

type ListOptions = {
  scenarioSetId?: string;
  batchRunId?: string;
  limit?: string;
  status?: string;
  name?: string;
};

type ListRequest = {
  options: ListOptions;
  endpoint: string;
  apiKey: string;
  spinner: Ora;
};

const plural = (count: number): string => (count !== 1 ? "s" : "");

async function fetchRunsPage({
  request,
  cursor,
  limitOverride,
}: {
  request: ListRequest;
  cursor?: string;
  limitOverride?: number;
}): Promise<SimulationRunListPage> {
  const { options, endpoint, apiKey, spinner } = request;
  const params = new URLSearchParams();
  if (options.scenarioSetId) params.set("scenarioSetId", options.scenarioSetId);
  if (options.batchRunId) params.set("batchRunId", options.batchRunId);
  const limit = limitOverride === undefined ? options.limit : String(limitOverride);
  if (limit) params.set("limit", limit);
  if (cursor) params.set("cursor", cursor);

  const response = await langwatchFetch(`${endpoint}/api/v1/simulation-runs?${params.toString()}`, {
    method: "GET",
    headers: buildAuthHeaders({ apiKey }),
  });

  if (!response.ok) {
    // The status and the body go to the reader together, so a handled
    // failure keeps its code — a 422 for `--limit 200` names
    // validation_error and the ceiling, instead of degrading to network_error.
    failSpinner({
      spinner,
      error: await readFetchFailure(response),
      action: "fetch simulation runs",
    });
    process.exit(1);
  }

  return (await response.json()) as SimulationRunListPage;
}

function runMatches({
  options,
  run,
}: {
  options: ListOptions;
  run: SimulationRunListItem;
}): boolean {
  if (options.status && run.status.toUpperCase() !== options.status.toUpperCase()) return false;
  if (options.name) {
    const runName = (run.name ?? "").toLowerCase();
    if (!runName.includes(options.name.toLowerCase())) return false;
  }
  return true;
}

type ScanResult = {
  page: SimulationRunListPage;
  runs: SimulationRunListItem[];
  scanned: number;
  scanStoppedEarly: boolean;
};

/**
 * Status / name narrow the listing client-side. The scan follows the cursor
 * while it has found nothing, then stops at the first page with a match: the
 * pages come newest first, so that page holds the most recent runs.
 */
async function scanForMatches({
  request,
  hasClientFilters,
}: {
  request: ListRequest;
  hasClientFilters: boolean;
}): Promise<ScanResult> {
  const matches = (run: SimulationRunListItem) => runMatches({ options: request.options, run });
  let page = await fetchRunsPage({ request });
  let runs = page.runs.filter(matches);
  let scanned = page.runs.length;

  while (hasClientFilters && runs.length === 0 && page.hasMore && page.nextCursor) {
    if (scanned >= FILTER_SCAN_RUN_CEILING) return { page, runs, scanned, scanStoppedEarly: true };
    // The last page is cut to what is left of the ceiling, so the scan stops
    // AT it. The cut only ever makes the page smaller than the one in use.
    const remaining = FILTER_SCAN_RUN_CEILING - scanned;
    const pageLimit = remaining < page.runs.length ? remaining : undefined;
    page = await fetchRunsPage({ request, cursor: page.nextCursor, limitOverride: pageLimit });
    runs = page.runs.filter(matches);
    scanned += page.runs.length;
  }
  return { page, runs, scanned, scanStoppedEarly: false };
}

function printNoRuns({
  options,
  hasClientFilters,
  scan,
}: {
  options: ListOptions;
  hasClientFilters: boolean;
  scan: ScanResult;
}): void {
  console.log();
  if (!hasClientFilters) {
    console.log(chalk.gray("No simulation runs found."));
    console.log(chalk.gray("Run a suite to create simulation runs:"));
    console.log(chalk.cyan("  langwatch test-suite run <suiteId>"));
    return;
  }
  const filters = [
    options.status ? `status ${options.status.toUpperCase()}` : undefined,
    options.name ? `name containing "${options.name}"` : undefined,
  ]
    .filter(Boolean)
    .join(" and ");
  const unscanned =
    scan.scanStoppedEarly || scan.page.hasMore ? "; older runs were not scanned" : "";
  console.log(
    chalk.gray(
      `No run with ${filters} in the newest ${scan.scanned} run${plural(scan.scanned)}${unscanned}.`,
    ),
  );
}

function printRun(run: SimulationRunListItem): void {
  const statusColor = simulationStatusColor(run.status);
  const verdict = run.results?.verdict;
  const verdictStr = verdict ? ` (${verdict})` : "";
  const duration = run.durationInMs > 0 ? `${(run.durationInMs / 1000).toFixed(1)}s` : "—";
  const cost = run.totalCost ? `$${run.totalCost.toFixed(4)}` : "";
  const when = run.timestamp ? formatRelativeTime(new Date(run.timestamp).toISOString()) : "—";
  // The note and the version keep their place whether or not the run
  // carries them, so the block reads the same down the whole list.
  const note = run.note ?? chalk.gray("—");
  const version = run.scenarioVersion ? `v${run.scenarioVersion}` : chalk.gray("—");

  console.log(
    `  ${statusColor("●")} ${chalk.cyan(run.name ?? run.scenarioId)} ${statusColor(run.status)}${verdictStr} ${chalk.gray(`· ${when}`)}`,
  );
  console.log(
    `    ${chalk.gray("Run ID:")} ${run.scenarioRunId}  ${chalk.gray("Duration:")} ${duration}  ${cost ? chalk.gray("Cost:") + " " + cost : ""}`,
  );
  console.log(`    ${chalk.gray("Version:")} ${version}  ${chalk.gray("Note:")} ${note}`);
  console.log();
}

function printRunsTable({
  options,
  hasClientFilters,
  scan,
}: {
  options: ListOptions;
  hasClientFilters: boolean;
  scan: ScanResult;
}): void {
  if (scan.runs.length === 0) {
    printNoRuns({ options, hasClientFilters, scan });
    return;
  }
  console.log();
  for (const run of scan.runs) printRun(run);
  if (scan.page.hasMore) {
    console.log(chalk.gray("  More runs available. Use --limit to fetch more."));
  }
  console.log(
    chalk.gray(`Use ${chalk.cyan("langwatch simulation-run get <runId>")} to view full details`),
  );
}

export const listSimulationRunsCommand = async (
  options: ListOptions,
): Promise<CommandResult | void> => {
  await resolveCredentials();

  const apiKey = scopedApiKey() ?? process.env.LANGWATCH_API_KEY ?? "";
  const endpoint = resolveControlPlaneUrl();

  const spinner = createSpinner("Fetching simulation runs...").start();

  try {
    const request: ListRequest = { options, endpoint, apiKey, spinner };
    const hasClientFilters = Boolean(options.status ?? options.name);
    const scan = await scanForMatches({ request, hasClientFilters });
    const { page, runs, scanned } = scan;

    const scanNote =
      hasClientFilters && scanned > 0
        ? ` (scanned the newest ${scanned} run${plural(scanned)})`
        : "";
    spinner.succeed(
      `Found ${runs.length} simulation run${plural(runs.length)}${page.hasMore ? " (more available)" : ""}${scanNote}`,
    );

    return {
      data: { ...page, runs, ...(hasClientFilters ? { scanned } : {}) },
      table: () => printRunsTable({ options, hasClientFilters, scan }),
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch simulation runs" });
    process.exit(1);
  }
};

function simulationStatusColor(status: string) {
  if (status === "SUCCESS") return chalk.green;
  if (status === "FAILED" || status === "ERROR") return chalk.red;
  if (status === "IN_PROGRESS" || status === "RUNNING") return chalk.yellow;
  return chalk.gray;
}

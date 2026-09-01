import { scopedApiKey } from "@/internal/credentialContext";
import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { resolveCredentials } from "../../utils/apiKey";
import { readFetchFailure } from "../../utils/formatFetchError";
import { failSpinner } from "../../utils/spinnerError";
import { formatRelativeTime } from "../../utils/formatting";
import type { CommandResult } from "../../utils/output";
import { buildAuthHeaders } from "@/internal/api/auth";

import { resolveControlPlaneUrl } from "@/cli/utils/governance/resolveEndpoint";

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
 * The listing pages by batch, so one page can hold no run that matches a
 * status or name filter while later pages do. The scan keeps following the
 * cursor until it finds matches, up to this many runs, so `--status FAILED`
 * answers with the failed runs it can reach instead of an empty first page.
 */
const FILTER_SCAN_RUN_CEILING = 500;

export const listSimulationRunsCommand = async (options: {
  scenarioSetId?: string;
  batchRunId?: string;
  limit?: string;
  status?: string;
  name?: string;
}): Promise<CommandResult | void> => {
  await resolveCredentials();

  const apiKey = scopedApiKey() ?? process.env.LANGWATCH_API_KEY ?? "";
  const endpoint = resolveControlPlaneUrl();

  const spinner = createSpinner("Fetching simulation runs...").start();

  try {
    const fetchPage = async (
      cursor?: string,
      limitOverride?: number,
    ): Promise<SimulationRunListPage> => {
      const params = new URLSearchParams();
      if (options.scenarioSetId)
        params.set("scenarioSetId", options.scenarioSetId);
      if (options.batchRunId) params.set("batchRunId", options.batchRunId);
      const limit =
        limitOverride === undefined ? options.limit : String(limitOverride);
      if (limit) params.set("limit", limit);
      if (cursor) params.set("cursor", cursor);

      const response = await fetch(
        `${endpoint}/api/simulation-runs?${params.toString()}`,
        {
          method: "GET",
          headers: buildAuthHeaders({ apiKey }),
        },
      );

      if (!response.ok) {
        // The status and the body go to the reader together, so a handled
        // failure keeps its code — a 422 for `--limit 200` names
        // validation_error and the ceiling, instead of degrading to
        // network_error the moment it is flattened into a message string.
        failSpinner({
          spinner,
          error: await readFetchFailure(response),
          action: "fetch simulation runs",
        });
        process.exit(1);
      }

      return (await response.json()) as SimulationRunListPage;
    };

    const matchesFilters = (run: SimulationRunListItem): boolean => {
      if (options.status) {
        if (run.status.toUpperCase() !== options.status.toUpperCase())
          return false;
      }
      if (options.name) {
        if (!(run.name ?? "").toLowerCase().includes(options.name.toLowerCase()))
          return false;
      }
      return true;
    };

    const hasClientFilters = Boolean(options.status ?? options.name);

    let page = await fetchPage();
    let runs = page.runs.filter(matchesFilters);
    let scanned = page.runs.length;
    let scanStoppedEarly = false;

    // Status / name narrow the listing client-side. The scan follows the
    // cursor while it has found nothing, then stops at the first page with a
    // match: the pages come newest first, so that page holds the most recent
    // runs the filter reaches.
    while (
      hasClientFilters &&
      runs.length === 0 &&
      page.hasMore &&
      page.nextCursor
    ) {
      if (scanned >= FILTER_SCAN_RUN_CEILING) {
        scanStoppedEarly = true;
        break;
      }
      // The last page is cut to what is left of the ceiling, so the scan
      // stops AT it rather than up to one page past it. The cut only ever
      // makes the page smaller than the one already in use: the API refuses
      // a limit above its own ceiling, and a smaller one it always takes.
      const remaining = FILTER_SCAN_RUN_CEILING - scanned;
      const pageLimit = remaining < page.runs.length ? remaining : undefined;
      page = await fetchPage(page.nextCursor, pageLimit);
      runs = page.runs.filter(matchesFilters);
      scanned += page.runs.length;
    }

    const scanNote =
      hasClientFilters && scanned > 0
        ? ` (scanned the newest ${scanned} run${scanned !== 1 ? "s" : ""})`
        : "";
    spinner.succeed(
      `Found ${runs.length} simulation run${runs.length !== 1 ? "s" : ""}${page.hasMore ? " (more available)" : ""}${scanNote}`,
    );

    return {
      data: { ...page, runs, ...(hasClientFilters ? { scanned } : {}) },
      table: () => {
        if (runs.length === 0) {
          console.log();
          if (hasClientFilters) {
            const filters = [
              options.status ? `status ${options.status.toUpperCase()}` : undefined,
              options.name ? `name containing "${options.name}"` : undefined,
            ]
              .filter(Boolean)
              .join(" and ");
            console.log(
              chalk.gray(
                `No run with ${filters} in the newest ${scanned} run${scanned !== 1 ? "s" : ""}${scanStoppedEarly || page.hasMore ? "; older runs were not scanned" : ""}.`,
              ),
            );
            return;
          }
          console.log(chalk.gray("No simulation runs found."));
          console.log(chalk.gray("Run a suite to create simulation runs:"));
          console.log(chalk.cyan("  langwatch test-suite run <suiteId>"));
          return;
        }

        console.log();
        for (const run of runs) {
          const statusColor = run.status === "SUCCESS" ? chalk.green
            : run.status === "FAILED" ? chalk.red
            : run.status === "ERROR" ? chalk.red
            : run.status === "IN_PROGRESS" || run.status === "RUNNING" ? chalk.yellow
            : chalk.gray;

          const verdict = run.results?.verdict;
          const verdictStr = verdict ? ` (${verdict})` : "";
          const duration = run.durationInMs > 0 ? `${(run.durationInMs / 1000).toFixed(1)}s` : "—";
          const cost = run.totalCost ? `$${run.totalCost.toFixed(4)}` : "";
          const when = run.timestamp ? formatRelativeTime(new Date(run.timestamp).toISOString()) : "—";

          // The note and the version keep their place whether or not the run
          // carries them, so the block reads the same down the whole list.
          const note = run.note ?? chalk.gray("—");
          const version = run.scenarioVersion
            ? `v${run.scenarioVersion}`
            : chalk.gray("—");

          console.log(`  ${statusColor("●")} ${chalk.cyan(run.name ?? run.scenarioId)} ${statusColor(run.status)}${verdictStr} ${chalk.gray(`· ${when}`)}`);
          console.log(`    ${chalk.gray("Run ID:")} ${run.scenarioRunId}  ${chalk.gray("Duration:")} ${duration}  ${cost ? chalk.gray("Cost:") + " " + cost : ""}`);
          console.log(`    ${chalk.gray("Version:")} ${version}  ${chalk.gray("Note:")} ${note}`);
          console.log();
        }

        if (page.hasMore) {
          console.log(chalk.gray("  More runs available. Use --limit to fetch more."));
        }

        console.log(
          chalk.gray(`Use ${chalk.cyan("langwatch simulation-run get <runId>")} to view full details`),
        );
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch simulation runs" });
    process.exit(1);
  }
};

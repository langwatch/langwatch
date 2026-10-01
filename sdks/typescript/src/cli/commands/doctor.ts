import chalk from "chalk";

import { resolveControlPlaneUrl } from "@/cli/utils/governance/resolveEndpoint";
import { buildAuthHeaders } from "@/internal/api/auth";
import { scopedApiKey } from "@/internal/credentialContext";
import { langwatchFetch } from "@/internal/http/langwatchFetch";

import { resolveCredentials } from "../utils/apiKey";
import { readFetchFailure } from "../utils/formatFetchError";
import type { CommandResult } from "../utils/output";
import { createSpinner } from "../utils/spinner";
import { failSpinner } from "../utils/spinnerError";

/**
 * `langwatch doctor`: a self-hosted install's checkup from a terminal. The install decides the
 * verdict behind `GET /api/checkup` and `POST /api/checkup/run`; this only asks and prints.
 * @see sdks/typescript/specs/cli/doctor.feature
 */

export type CheckOutcome = "verified" | "refused" | "unchecked";

export interface DoctorRow {
  id: string;
  name: string;
  group: string;
  cost: "free" | "egress" | "paid";
  verdict: {
    outcome: CheckOutcome;
    /** Absent for a project key: only an install admin reads what a check found. */
    detail?: string;
    fix?: string;
    code?: string;
    docsPath?: string;
  };
}

export interface DoctorReport {
  ranAt: string;
  rows: DoctorRow[];
  /** A project key reads its own organization's figures, without the install-wide fields. */
  usageReport: {
    payload: Record<string, unknown>;
    switches?: { optional: boolean; hostname: boolean };
    endpoint?: string;
    disabled?: boolean;
    schemaVersion: number;
    nextReportAt?: string | null;
  };
}

const GROUP_TITLES: Record<string, string> = {
  install: "Install",
  langwatch: "LangWatch",
  integrations: "Integrations",
  pipelines: "Pipelines",
};

export const doctorCommand = async (options: {
  run?: boolean;
  scenarioRunPlanId?: string;
}): Promise<CommandResult | void> => {
  await resolveCredentials();

  const apiKey = scopedApiKey() ?? process.env.LANGWATCH_API_KEY ?? "";
  const endpoint = resolveControlPlaneUrl();
  const spinner = createSpinner("Running the checkup...").start();

  try {
    const response = await langwatchFetch(`${endpoint}/api/checkup`, {
      method: "GET",
      headers: buildAuthHeaders({ apiKey }),
    });
    if (!response.ok) {
      failSpinner({
        spinner,
        error: await readFetchFailure(response),
        action: "run the checkup",
      });
      process.exit(1);
    }
    const report = (await response.json()) as DoctorReport;

    if (options.run) {
      spinner.text = "Running the checks that cost egress or money...";
      const explicit = await langwatchFetch(`${endpoint}/api/checkup/run`, {
        method: "POST",
        headers: {
          ...buildAuthHeaders({ apiKey }),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          options.scenarioRunPlanId ? { scenarioRunPlanId: options.scenarioRunPlanId } : {},
        ),
      });
      if (!explicit.ok) {
        failSpinner({
          spinner,
          error: await readFetchFailure(explicit),
          action: "run the explicit checks",
        });
        process.exit(1);
      }
      const ran = (await explicit.json()) as { rows: DoctorRow[] };
      const byId = new Map(ran.rows.map((row) => [row.id, row]));
      report.rows = report.rows.map((row) => byId.get(row.id) ?? row);
    }

    const counts = countOutcomes(report.rows);
    spinner.succeed(
      `${counts.verified} pass, ${counts.refused} fail, ${counts.unchecked} not checked`,
    );

    return {
      data: report,
      table: () => printReport(report),
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "run the checkup" });
    process.exit(1);
  }
};

export function countOutcomes(rows: DoctorRow[]): Record<CheckOutcome, number> {
  const counts: Record<CheckOutcome, number> = {
    verified: 0,
    refused: 0,
    unchecked: 0,
  };
  for (const row of rows) counts[row.verdict.outcome] += 1;
  return counts;
}

/** PASS, FAIL or NOT CHECKED: the three words, in the three colours. */
export function verdictLabel(outcome: CheckOutcome): string {
  switch (outcome) {
    case "verified":
      return chalk.green("PASS");
    case "refused":
      return chalk.red("FAIL");
    default:
      return chalk.gray("NOT CHECKED");
  }
}

export function printReport(report: DoctorReport): void {
  console.log();
  let group = "";
  for (const row of report.rows) {
    if (row.group !== group) {
      group = row.group;
      console.log(chalk.bold(GROUP_TITLES[group] ?? group));
    }
    console.log(`  ${verdictLabel(row.verdict.outcome).padEnd(22)} ${row.name}`);
    if (row.verdict.detail) console.log(chalk.gray(`      ${row.verdict.detail}`));
    if (row.verdict.outcome !== "verified" && row.verdict.fix) {
      console.log(chalk.yellow(`      Fix: ${row.verdict.fix}`));
    }
    if (row.verdict.outcome !== "verified" && row.verdict.docsPath) {
      console.log(chalk.gray(`      https://docs.langwatch.ai${row.verdict.docsPath}`));
    }
  }
  console.log();
  const usage = report.usageReport;
  printUsageHeader(usage);
  console.log(JSON.stringify(usage.payload, null, 2));
  console.log();
  console.log(
    chalk.gray(
      "Every field is explained at https://docs.langwatch.ai/self-hosting/data-and-telemetry",
    ),
  );
}

function printUsageHeader(usage: DoctorReport["usageReport"]): void {
  if (usage.endpoint === undefined || usage.switches === undefined) {
    printOrganizationUsage(usage);
    return;
  }
  console.log(chalk.bold("What this install sends to LangWatch"));
  console.log(
    chalk.gray(
      usage.disabled
        ? "  Usage reporting is switched off with DISABLE_USAGE_STATS. This is the report that would be sent."
        : `  One report a day to ${usage.endpoint}${usage.nextReportAt ? `, next at ${usage.nextReportAt}` : ""}.`,
    ),
  );
  console.log(
    chalk.gray(
      `  Schema version ${usage.schemaVersion}. Usage counts: ${usage.switches.optional ? "on" : "off"}. Hostname: ${usage.switches.hostname ? "on" : "off"}.`,
    ),
  );
}

function printOrganizationUsage(usage: DoctorReport["usageReport"]): void {
  console.log(chalk.bold("What this organization adds to the install's usage report"));
  console.log(
    chalk.gray(
      `  Schema version ${usage.schemaVersion}. An install administrator sees the whole report on the Settings > Checkup page.`,
    ),
  );
}

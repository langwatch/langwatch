import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { checkApiKey } from "../../utils/apiKey";
import { formatFetchError } from "../../utils/formatFetchError";
import { formatTable } from "../../utils/formatting";
import { failSpinner } from "../../utils/spinnerError";
import { printResult, type RawOutputFlags } from "../../utils/output";
import { buildAuthHeaders } from "@/internal/api/auth";

import { resolveControlPlaneUrl } from "@/cli/utils/governance/resolveEndpoint";
export const listMonitorsCommand = async (options?: RawOutputFlags): Promise<void> => {
  checkApiKey();

  const apiKey = process.env.LANGWATCH_API_KEY ?? "";
  const endpoint =
    resolveControlPlaneUrl();

  const spinner = createSpinner("Fetching monitors...").start();

  let monitors: Array<{
    id: string;
    name: string;
    checkType: string;
    enabled: boolean;
    executionMode: string;
    sample: number;
  }>;
  try {
    const response = await fetch(`${endpoint}/api/monitors`, {
      headers: buildAuthHeaders({ apiKey }),
    });

    if (!response.ok) {
      const message = await formatFetchError(response);
      failSpinner({ spinner, error: new Error(message), action: "fetch monitors" });
      process.exit(1);
    }

    monitors = (await response.json()) as Array<{
      id: string;
      name: string;
      checkType: string;
      enabled: boolean;
      executionMode: string;
      sample: number;
    }>;

    spinner.succeed(
      `Found ${monitors.length} monitor${monitors.length !== 1 ? "s" : ""}`
    );
  } catch (error) {
    // No explicit `format`: see traces/search.ts — the preAction hook covers
    // every spelling; the `-f` commander default must not override it.
    failSpinner({ spinner, error, action: "fetch monitors" });
    process.exit(1);
  }

  // Rendering stays OUTSIDE the fetch try: a printResult rejection (invalid
  // --jq) is a rendering failure, not a fetch failure.
  await printResult(monitors, {
      ...options,
      table: () => {
        if (monitors.length === 0) {
          console.log();
          console.log(chalk.gray("No monitors found."));
          console.log(chalk.gray("Create one with:"));
          console.log(
            chalk.cyan(
              '  langwatch monitor create "Toxicity Check" --check-type ragas/toxicity'
            )
          );
          return;
        }

        console.log();

        const tableData = monitors.map((m) => ({
          Name: m.name,
          ID: m.id,
          Type: m.checkType,
          Mode: m.executionMode,
          Status: m.enabled ? chalk.green("enabled") : chalk.gray("disabled"),
          Sample: `${Math.round(m.sample * 100)}%`,
        }));

        formatTable({
          data: tableData,
          headers: ["Name", "ID", "Type", "Mode", "Status", "Sample"],
          colorMap: {
            Name: chalk.cyan,
            ID: chalk.green,
          },
        });

        console.log();
      },
    });
};

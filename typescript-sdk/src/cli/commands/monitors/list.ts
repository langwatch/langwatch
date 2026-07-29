import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { apiRequest } from "../../utils/apiClient";
import { checkApiKey } from "../../utils/apiKey";
import { formatTable } from "../../utils/formatting";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";

import { resolveControlPlaneUrl } from "@/cli/utils/governance/resolveEndpoint";
/**
 * Returns the listing rather than printing it: the output port renders it in
 * whatever format the caller asked for (utils/output.ts). The `table` closure
 * is the human form, byte-identical to what this command printed before.
 */
export const listMonitorsCommand = async (): Promise<CommandResult | void> => {
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
    monitors = (await apiRequest({
      method: "GET",
      path: "/api/monitors",
      apiKey,
      endpoint,
    })) as Array<{
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

  return {
    data: monitors,
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
  };
};

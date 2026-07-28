import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { checkApiKey } from "../../utils/apiKey";
import { formatFetchError } from "../../utils/formatFetchError";
import { formatTable } from "../../utils/formatting";
import { failSpinner } from "../../utils/spinnerError";
import { buildAuthHeaders } from "@/internal/api/auth";
import type { CommandResult } from "../../utils/output";

import { resolveControlPlaneUrl } from "@/cli/utils/governance/resolveEndpoint";
/**
 * Returns the listing rather than printing it: the output port renders it in
 * whatever format the caller asked for (utils/output.ts). The `table` closure
 * is the human form, byte-identical to what this command printed before.
 */
export const listGraphsCommand = async (options: {
  dashboardId?: string;
}): Promise<CommandResult | void> => {
  checkApiKey();

  const apiKey = process.env.LANGWATCH_API_KEY ?? "";
  const endpoint = resolveControlPlaneUrl();

  const spinner = createSpinner("Fetching graphs...").start();

  try {
    const params = new URLSearchParams();
    if (options.dashboardId) params.set("dashboardId", options.dashboardId);
    const qs = params.toString() ? `?${params}` : "";

    const response = await fetch(`${endpoint}/api/graphs${qs}`, {
      headers: buildAuthHeaders({ apiKey }),
    });

    if (!response.ok) {
      const message = await formatFetchError(response);
      failSpinner({ spinner, error: new Error(message), action: "fetch graphs" });
      process.exit(1);
    }

    const graphs = await response.json() as Array<{
      id: string;
      name: string;
      dashboardId: string | null;
      gridColumn: number;
      gridRow: number;
      colSpan: number;
      rowSpan: number;
    }>;

    spinner.succeed(`Found ${graphs.length} graph${graphs.length !== 1 ? "s" : ""}`);

    return {
      data: graphs,
      table: () => {
        if (graphs.length === 0) {
          console.log();
          console.log(chalk.gray("No graphs found."));
          console.log(chalk.gray("Create one with:"));
          console.log(chalk.cyan('  langwatch graph create "My Graph" --dashboard-id <id> --graph \'{"type":"line"}\''));
          return;
        }

        console.log();

        const tableData = graphs.map((g) => ({
          Name: g.name,
          ID: g.id,
          Dashboard: g.dashboardId ?? chalk.gray("—"),
          Position: `(${g.gridColumn},${g.gridRow})`,
          Size: `${g.colSpan}x${g.rowSpan}`,
        }));

        formatTable({
          data: tableData,
          headers: ["Name", "ID", "Dashboard", "Position", "Size"],
          colorMap: {
            Name: chalk.cyan,
            ID: chalk.green,
          },
        });

        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch graphs" });
    process.exit(1);
  }
};

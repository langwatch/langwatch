import chalk from "chalk";
import ora from "ora";
import { checkApiKey } from "../../utils/apiKey";
import { formatTable } from "../../utils/formatting";

export const listGraphsCommand = async (options: {
  dashboardId?: string;
  format?: string;
}): Promise<void> => {
  checkApiKey();

  const apiKey = process.env.LANGWATCH_API_KEY ?? "";
  const endpoint = process.env.LANGWATCH_ENDPOINT ?? "https://app.langwatch.ai";

  const spinner = ora("Fetching graphs...").start();

  try {
    const params = new URLSearchParams();
    if (options.dashboardId) params.set("dashboardId", options.dashboardId);
    const qs = params.toString() ? `?${params}` : "";

    const response = await fetch(`${endpoint}/api/graphs${qs}`, {
      headers: { "X-Auth-Token": apiKey },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      spinner.fail(`Failed to fetch graphs (${response.status})`);
      console.error(chalk.red(`Error: ${errorBody}`));
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

    if (options.format === "json") {
      console.log(JSON.stringify(graphs, null, 2));
      return;
    }

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
  } catch (error) {
    spinner.fail();
    console.error(chalk.red(`Error: ${error instanceof Error ? error.message : "Unknown error"}`));
    process.exit(1);
  }
};

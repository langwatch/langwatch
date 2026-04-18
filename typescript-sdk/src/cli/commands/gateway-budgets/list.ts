import chalk from "chalk";
import ora from "ora";
import { GatewayBudgetsApiService } from "@/client-sdk/services/gateway-budgets/gateway-budgets-api.service";
import { checkApiKey } from "../../utils/apiKey";
import { formatTable } from "../../utils/formatting";
import { failSpinner } from "../../utils/spinnerError";

export const listGatewayBudgetsCommand = async (options?: { format?: string }): Promise<void> => {
  checkApiKey();

  const service = new GatewayBudgetsApiService();
  const spinner = ora("Fetching gateway budgets...").start();

  try {
    const budgets = await service.list();

    spinner.succeed(`Found ${budgets.length} budget${budgets.length !== 1 ? "s" : ""}`);

    if (options?.format === "json") {
      console.log(JSON.stringify(budgets, null, 2));
      return;
    }

    if (budgets.length === 0) {
      console.log();
      console.log(chalk.gray("No gateway budgets configured."));
      console.log(chalk.gray("Create one with:"));
      console.log(
        chalk.cyan('  langwatch gateway-budgets create --scope project --project <id> --window day --limit 100 --name "daily cap"'),
      );
      return;
    }

    console.log();

    const tableData = budgets.map((b) => {
      const limit = Number.parseFloat(b.limit_usd);
      const spent = Number.parseFloat(b.spent_usd);
      const pct = limit > 0 ? (spent / limit) * 100 : 0;
      const pctLabel = `${pct.toFixed(0)}%`;
      const coloredPct = pct >= 100 ? chalk.red(pctLabel) : pct >= 80 ? chalk.yellow(pctLabel) : chalk.green(pctLabel);
      return {
        ID: b.id,
        Name: b.name,
        Scope: `${b.scope_type.toLowerCase()}:${b.scope_id.slice(0, 10)}...`,
        Window: b.window.toLowerCase(),
        Breach: b.on_breach === "BLOCK" ? chalk.red("block") : chalk.yellow("warn"),
        Limit: `$${limit.toFixed(2)}`,
        Spent: `$${spent.toFixed(2)} (${coloredPct})`,
        Resets: new Date(b.resets_at).toLocaleString(),
        Archived: b.archived_at ? chalk.gray("yes") : "",
      };
    });

    formatTable({
      data: tableData,
      headers: ["ID", "Name", "Scope", "Window", "Breach", "Limit", "Spent", "Resets", "Archived"],
      colorMap: { Name: chalk.cyan, ID: chalk.gray },
    });

    console.log();
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch gateway budgets" });
    process.exit(1);
  }
};

import chalk from "chalk";
import ora from "ora";
import { GatewayBudgetsApiService } from "@/client-sdk/services/gateway-budgets/gateway-budgets-api.service";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";

export const archiveGatewayBudgetCommand = async (
  id: string,
  options?: { format?: string },
): Promise<void> => {
  checkApiKey();

  const service = new GatewayBudgetsApiService();
  const spinner = ora(`Archiving budget "${id}"...`).start();

  try {
    const budget = await service.archive(id);

    spinner.succeed(`Archived budget "${chalk.cyan(budget.name)}"`);

    if (options?.format === "json") {
      console.log(JSON.stringify(budget, null, 2));
      return;
    }

    console.log();
    console.log(chalk.gray("Archived at: ") + (budget.archived_at ? new Date(budget.archived_at).toLocaleString() : chalk.gray("—")));
    console.log();
  } catch (error) {
    failSpinner({ spinner, error, action: "archive gateway budget" });
    process.exit(1);
  }
};

import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { GatewayBudgetsApiService } from "@/client-sdk/services/gateway-budgets/gateway-budgets-api.service";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";

/**
 * Returns the archived budget rather than printing it: the output port renders
 * it in whatever format the caller asked for (utils/output.ts).
 */
export const archiveGatewayBudgetCommand = async (
  id: string,
): Promise<CommandResult | void> => {
  checkApiKey();

  const service = new GatewayBudgetsApiService();
  const spinner = createSpinner(`Archiving budget "${id}"...`).start();

  try {
    const budget = await service.archive(id);

    spinner.succeed(`Archived budget "${chalk.cyan(budget.name)}"`);

    return {
      data: budget,
      table: () => {
        console.log();
        console.log(chalk.gray("Archived at: ") + (budget.archived_at ? new Date(budget.archived_at).toLocaleString() : chalk.gray("—")));
        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "archive gateway budget" });
    process.exit(1);
  }
};

import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { GatewayBudgetsApiService } from "@/client-sdk/services/gateway-budgets/gateway-budgets-api.service";
import { resolveCredentials } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";

/**
 * Moves the period boundary; never mutates recorded spend. With
 * --end-user, only that end-user bucket's boundary moves (attributed-user
 * templates), which is the mid-cycle single-user reset.
 */
export const resetGatewayBudgetCommand = async (
  id: string,
  options: { endUser?: string; reason?: string },
): Promise<CommandResult | void> => {
  await resolveCredentials();

  const service = new GatewayBudgetsApiService();
  const label = options.endUser
    ? `Resetting budget "${id}" for end user "${options.endUser}"...`
    : `Resetting budget "${id}"...`;
  const spinner = createSpinner(label).start();

  try {
    const budget = await service.reset(id, {
      endUserId: options.endUser,
      reason: options.reason,
    });

    spinner.succeed(
      options.endUser
        ? `Reset end-user bucket on "${chalk.cyan(budget.name)}"`
        : `Reset budget "${chalk.cyan(budget.name)}"`,
    );

    return {
      data: budget,
      table: () => {
        console.log();
        console.log(
          chalk.gray("Period started: ") +
            new Date(budget.current_period_started_at).toLocaleString(),
        );
        console.log(
          chalk.gray("Next reset:     ") +
            (budget.window === "manual" || budget.window === "total"
              ? chalk.gray("manual")
              : new Date(budget.resets_at).toLocaleString()),
        );
        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "reset gateway budget" });
    process.exit(1);
  }
};

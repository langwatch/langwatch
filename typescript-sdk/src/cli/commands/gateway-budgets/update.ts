import chalk from "chalk";
import ora from "ora";
import {
  type BudgetOnBreach,
  GatewayBudgetsApiService,
} from "@/client-sdk/services/gateway-budgets/gateway-budgets-api.service";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";

export interface UpdateGatewayBudgetOptions {
  name?: string;
  description?: string;
  clearDescription?: boolean;
  limit?: string;
  onBreach?: "block" | "warn";
  timezone?: string;
  clearTimezone?: boolean;
  format?: string;
}

export const updateGatewayBudgetCommand = async (
  id: string,
  options: UpdateGatewayBudgetOptions,
): Promise<void> => {
  checkApiKey();

  const onBreach: BudgetOnBreach | undefined = options.onBreach
    ? (options.onBreach.toUpperCase() as BudgetOnBreach)
    : undefined;

  const noFieldsProvided =
    options.name === undefined &&
    options.description === undefined &&
    !options.clearDescription &&
    options.limit === undefined &&
    onBreach === undefined &&
    options.timezone === undefined &&
    !options.clearTimezone;

  if (noFieldsProvided) {
    console.error(
      chalk.red(
        "Error: nothing to update. Provide at least one of --name, --description, --clear-description, --limit, --on-breach, --timezone, --clear-timezone.",
      ),
    );
    process.exit(1);
  }

  const service = new GatewayBudgetsApiService();
  const spinner = ora(`Updating budget "${id}"...`).start();

  try {
    const budget = await service.update(id, {
      name: options.name,
      description: options.clearDescription ? null : options.description,
      limit_usd: options.limit,
      on_breach: onBreach,
      timezone: options.clearTimezone ? null : options.timezone,
    });

    spinner.succeed(`Updated budget "${chalk.cyan(budget.name)}"`);

    if (options.format === "json") {
      console.log(JSON.stringify(budget, null, 2));
      return;
    }

    console.log();
    console.log(`${chalk.bold("ID:")}       ${budget.id}`);
    console.log(`${chalk.bold("Scope:")}    ${budget.scope_type.toLowerCase()}:${budget.scope_id}`);
    console.log(`${chalk.bold("Window:")}   ${budget.window.toLowerCase()}`);
    console.log(`${chalk.bold("Limit:")}    $${budget.limit_usd}`);
    console.log(`${chalk.bold("Breach:")}   ${budget.on_breach.toLowerCase()}`);
    console.log(`${chalk.bold("Timezone:")} ${budget.timezone ?? chalk.gray("—")}`);
    console.log();
  } catch (error) {
    failSpinner({ spinner, error, action: "update gateway budget" });
    process.exit(1);
  }
};

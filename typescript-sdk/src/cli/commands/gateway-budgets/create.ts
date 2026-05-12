import chalk from "chalk";
import ora from "ora";
import {
  type BudgetOnBreach,
  type BudgetWindow,
  type CreateGatewayBudgetScope,
  GatewayBudgetsApiService,
} from "@/client-sdk/services/gateway-budgets/gateway-budgets-api.service";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";

export interface CreateGatewayBudgetOptions {
  name: string;
  description?: string;
  scope: "organization" | "team" | "project" | "virtual-key" | "principal";
  organization?: string;
  team?: string;
  project?: string;
  virtualKey?: string;
  principal?: string;
  window: string;
  limit: string;
  onBreach?: "block" | "warn";
  timezone?: string;
  format?: string;
}

const ALLOWED_WINDOWS: BudgetWindow[] = ["MINUTE", "HOUR", "DAY", "WEEK", "MONTH", "TOTAL"];

function buildScope(options: CreateGatewayBudgetOptions): CreateGatewayBudgetScope {
  switch (options.scope) {
    case "organization":
      if (!options.organization) {
        throw new Error("--organization <id> required for scope=organization");
      }
      return { kind: "ORGANIZATION", organization_id: options.organization };
    case "team":
      if (!options.team) throw new Error("--team <id> required for scope=team");
      return { kind: "TEAM", team_id: options.team };
    case "project":
      if (!options.project) throw new Error("--project <id> required for scope=project");
      return { kind: "PROJECT", project_id: options.project };
    case "virtual-key":
      if (!options.virtualKey) throw new Error("--virtual-key <id> required for scope=virtual-key");
      return { kind: "VIRTUAL_KEY", virtual_key_id: options.virtualKey };
    case "principal":
      if (!options.principal) throw new Error("--principal <id> required for scope=principal");
      return { kind: "PRINCIPAL", principal_user_id: options.principal };
  }
}

export const createGatewayBudgetCommand = async (
  options: CreateGatewayBudgetOptions,
): Promise<void> => {
  checkApiKey();

  const upperWindow = options.window.toUpperCase() as BudgetWindow;
  if (!ALLOWED_WINDOWS.includes(upperWindow)) {
    console.error(
      chalk.red(`Error: --window must be one of ${ALLOWED_WINDOWS.join(", ").toLowerCase()}`),
    );
    process.exit(1);
  }

  let scope: CreateGatewayBudgetScope;
  try {
    scope = buildScope(options);
  } catch (err) {
    console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
    process.exit(1);
  }

  const onBreach: BudgetOnBreach | undefined = options.onBreach
    ? (options.onBreach.toUpperCase() as BudgetOnBreach)
    : undefined;

  const service = new GatewayBudgetsApiService();
  const spinner = ora(`Creating budget "${options.name}"...`).start();

  try {
    const budget = await service.create({
      name: options.name,
      description: options.description,
      scope,
      window: upperWindow,
      limit_usd: options.limit,
      on_breach: onBreach,
      timezone: options.timezone ?? null,
    });

    spinner.succeed(`Created budget "${chalk.cyan(budget.name)}"`);

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
    console.log(`${chalk.bold("Resets:")}   ${new Date(budget.resets_at).toLocaleString()}`);
    console.log();
  } catch (error) {
    failSpinner({ spinner, error, action: "create gateway budget" });
    process.exit(1);
  }
};

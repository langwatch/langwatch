import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import {
  type BudgetOnBreach,
  type BudgetWindow,
  type CreateGatewayBudgetScope,
  GatewayBudgetsApiService,
} from "@/client-sdk/services/gateway-budgets/gateway-budgets-api.service";
import { resolveCredentials } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";

export interface CreateGatewayBudgetOptions {
  name: string;
  description?: string;
  scope: "organization" | "team" | "project" | "virtual-key" | "principal" | "group";
  organization?: string;
  team?: string;
  project?: string;
  virtualKey?: string;
  principal?: string;
  group?: string;
  window: string;
  limit: string;
  onBreach?: "block" | "warn";
  timezone?: string;
  providerKey?: string;
  cycleAnchorAt?: string;
}

const ALLOWED_WINDOWS = [
  "minute",
  "hour",
  "day",
  "week",
  "month",
  "total",
  "manual",
] as const satisfies readonly BudgetWindow[];

function buildScope(options: CreateGatewayBudgetOptions): CreateGatewayBudgetScope {
  switch (options.scope) {
    case "organization":
      if (!options.organization) {
        throw new Error("--organization <id> required for scope=organization");
      }
      return { kind: "organization", organization_id: options.organization };
    case "team":
      if (!options.team) throw new Error("--team <id> required for scope=team");
      return { kind: "team", team_id: options.team };
    case "project":
      if (!options.project) throw new Error("--project <id> required for scope=project");
      return { kind: "project", project_id: options.project };
    case "virtual-key":
      if (!options.virtualKey) throw new Error("--virtual-key <id> required for scope=virtual-key");
      return { kind: "virtual_key", virtual_key_id: options.virtualKey };
    case "principal":
      if (!options.principal) throw new Error("--principal <id> required for scope=principal");
      return { kind: "principal", principal_user_id: options.principal };
    case "group":
      // Per-member allowance: --limit is what EACH member may spend.
      // Requires a deployment with the ClickHouse spend ledger.
      if (!options.group) throw new Error("--group <id> required for scope=group");
      return { kind: "group", group_id: options.group };
  }
}

/**
 * Returns the created budget rather than printing it: the output port renders
 * it in whatever format the caller asked for (utils/output.ts).
 */
export const createGatewayBudgetCommand = async (
  options: CreateGatewayBudgetOptions,
): Promise<CommandResult | void> => {
  await resolveCredentials();

  // The flag stays case-insensitive for the human typing it; the wire value
  // is always lowercase.
  const window = options.window.toLowerCase() as BudgetWindow;
  if (!(ALLOWED_WINDOWS as readonly BudgetWindow[]).includes(window)) {
    console.error(
      chalk.red(`Error: --window must be one of ${ALLOWED_WINDOWS.join(", ")}`),
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
    ? (options.onBreach.toLowerCase() as BudgetOnBreach)
    : undefined;

  const service = new GatewayBudgetsApiService();
  const spinner = createSpinner(`Creating budget "${options.name}"...`).start();

  try {
    const budget = await service.create({
      name: options.name,
      description: options.description,
      scope,
      window,
      limit_usd: options.limit,
      on_breach: onBreach,
      timezone: options.timezone ?? null,
      provider_key: options.providerKey ?? null,
      // Immutable on the server, so an unset flag must leave the key off the
      // wire entirely rather than send a null the API would have to reject.
      ...(options.cycleAnchorAt ? { cycle_anchor_at: options.cycleAnchorAt } : {}),
    });

    spinner.succeed(`Created budget "${chalk.cyan(budget.name)}"`);

    return {
      data: budget,
      table: () => {
        const perMember = budget.scope_type === "group";
        console.log();
        console.log(`${chalk.bold("ID:")}       ${budget.id}`);
        console.log(`${chalk.bold("Scope:")}    ${budget.scope_type}:${budget.scope_id}`);
        console.log(`${chalk.bold("Window:")}   ${budget.window}`);
        console.log(
          `${chalk.bold("Limit:")}    $${budget.limit_usd}${perMember ? chalk.gray(` per member (${budget.member_count ?? 0} members)`) : ""}`,
        );
        console.log(`${chalk.bold("Breach:")}   ${budget.on_breach}`);
        if (budget.provider_key) {
          console.log(`${chalk.bold("Provider:")} ${budget.provider_key}`);
        }
        console.log(`${chalk.bold("Resets:")}   ${new Date(budget.resets_at).toLocaleString()}`);
        if (budget.cycle_anchor_at) {
          // Only anchored budgets have a phase worth showing; calendar
          // aligned ones are already implied by the window.
          console.log(
            `${chalk.bold("Anchor:")}   ${new Date(budget.cycle_anchor_at).toLocaleString()}`,
          );
        }
        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "create gateway budget" });
    process.exit(1);
  }
};

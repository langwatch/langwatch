import chalk from "chalk";

import {
  type BudgetScopeKind,
  type GatewayBudget,
  GatewayBudgetsApiService,
} from "@/client-sdk/services/gateway-budgets/gateway-budgets-api.service";

import { resolveCredentials } from "../../utils/apiKey";
import { formatTable } from "../../utils/formatting";
import type { CommandResult } from "../../utils/output";
import { createSpinner } from "../../utils/spinner";
import { failSpinner } from "../../utils/spinnerError";

export interface ListGatewayBudgetsOptions {
  scopeType?: string;
}

const SCOPE_KINDS: BudgetScopeKind[] = [
  "organization",
  "team",
  "project",
  "virtual_key",
  "principal",
  "group",
  "attributed_user",
];

/**
 * Returns the listing rather than printing it (output port renders
 * per-format). `data` keeps the full scope ids, exact decimals, and the
 * spend_available honesty flag that the table truncates/rounds/omits.
 */
export const listGatewayBudgetsCommand = async (
  options: ListGatewayBudgetsOptions = {},
): Promise<CommandResult | void> => {
  await resolveCredentials();

  let scopeTypes: BudgetScopeKind[] | undefined;
  if (options.scopeType) {
    // The flag stays case-insensitive and accepts dashes for the human
    // typing it; the query param is always lowercase snake_case.
    const requested = options.scopeType
      .split(",")
      .map((s) => s.trim().toLowerCase().replace(/-/g, "_"));
    const invalid = requested.filter((s) => !(SCOPE_KINDS as readonly string[]).includes(s));
    if (invalid.length > 0) {
      console.error(
        chalk.red(
          `Error: --scope-type must be a comma-separated subset of ${SCOPE_KINDS.join(", ")}`,
        ),
      );
      process.exit(1);
    }
    scopeTypes = requested as BudgetScopeKind[];
  }

  const service = new GatewayBudgetsApiService();
  const spinner = createSpinner("Fetching gateway budgets...").start();

  try {
    const budgets = await service.list({ scopeTypes });
    // A budget whose spend could not be totalled serves a null `spent_usd`
    // rather than a stale figure, so one null anywhere makes the whole
    // listing's spend unreal.
    const spend_available = budgets.every((b) => b.spent_usd !== null);

    spinner.succeed(`Found ${budgets.length} budget${budgets.length !== 1 ? "s" : ""}`);

    return {
      data: { budgets, spend_available },
      table: () => {
        if (budgets.length === 0) {
          console.log();
          console.log(chalk.gray("No gateway budgets configured."));
          console.log(chalk.gray("Create one with:"));
          console.log(
            chalk.cyan(
              '  langwatch gateway-budgets create --scope project --project <id> --window day --limit 100 --name "daily cap"',
            ),
          );
          return;
        }

        console.log();

        const tableData = budgets.map((b) => budgetTableRow(b, spend_available));

        formatTable({
          data: tableData,
          headers: [
            "ID",
            "Name",
            "Scope",
            "Window",
            "Breach",
            "Limit",
            "Spent",
            "Provider",
            "Resets",
            "Archived",
          ],
          colorMap: { Name: chalk.cyan, ID: chalk.gray },
        });

        console.log();
        if (!spend_available) {
          console.log(
            chalk.yellow(
              "Spend could not be totalled server-side; limits are shown but utilization is unknown.",
            ),
          );
          console.log();
        }
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch gateway budgets" });
    process.exit(1);
  }
};

function budgetTableRow(b: GatewayBudget, spend_available: boolean) {
  const limit = Number.parseFloat(b.limit_usd);
  // Null spend means it could not be totalled. Parsing null as 0
  // would render an unknown as a confident "$0.00 spent".
  const spent = b.spent_usd === null ? Number.NaN : Number.parseFloat(b.spent_usd);
  // `group` rows: limit is the PER-MEMBER allowance while spent sums
  // the whole group, so utilization compares against limit x members.
  const isGroup = b.scope_type === "group";
  // `attributed_user` rows: the limit belongs to each end user
  // separately, so there is no total to be a percentage of. The
  // standing is a headcount of who has passed their own cap.
  const effectiveLimit = isGroup ? limit * (b.member_count ?? 0) : limit;
  // A zero effective limit admits no spend at all: maximally
  // breached, not 0% utilized (matches `langwatch status`).
  const pct = effectiveLimit > 0 ? (spent / effectiveLimit) * 100 : 100;
  const coloredPct = budgetPercentage(pct);
  const spentLabel = budgetSpentLabel(b, spend_available, spent, coloredPct);
  return {
    ID: b.id,
    Name: b.name,
    Scope: `${b.scope_type}:${b.scope_id.slice(0, 10)}...`,
    Window: b.window,
    Breach: b.on_breach === "block" ? chalk.red("block") : chalk.yellow("warn"),
    Limit: budgetLimitLabel(b, limit),
    Spent: spentLabel,
    Provider: b.provider_key ?? chalk.gray("all"),
    Resets: new Date(b.resets_at).toLocaleString(),
    Archived: b.archived_at ? chalk.gray("yes") : "",
  };
}

function budgetPercentage(pct: number): string {
  const label = `${pct.toFixed(0)}%`;
  if (pct >= 100) {
    return chalk.red(label);
  }
  if (pct >= 80) {
    return chalk.yellow(label);
  }
  return chalk.green(label);
}

function budgetSpentLabel(
  b: GatewayBudget,
  spendAvailable: boolean,
  spent: number,
  coloredPct: string,
): string {
  if (!spendAvailable) {
    return chalk.gray("unavailable");
  }
  if (b.scope_type === "attributed_user") {
    const seatsOver = b.end_users_over ?? 0;
    const seatsLabel = `${seatsOver} of ${b.end_users_seen ?? 0} over cap`;
    return seatsOver > 0 ? chalk.red(seatsLabel) : chalk.green(seatsLabel);
  }
  return `$${spent.toFixed(2)} (${coloredPct})`;
}

function budgetLimitLabel(b: GatewayBudget, limit: number): string {
  if (b.scope_type === "group") {
    return `$${limit.toFixed(2)}/member x${b.member_count ?? 0}`;
  }
  if (b.scope_type === "attributed_user") {
    return `$${limit.toFixed(2)}/person`;
  }
  return `$${limit.toFixed(2)}`;
}

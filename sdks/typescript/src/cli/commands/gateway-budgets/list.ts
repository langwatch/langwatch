import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import {
  type BudgetScopeKind,
  GatewayBudgetsApiService,
} from "@/client-sdk/services/gateway-budgets/gateway-budgets-api.service";
import { resolveCredentials } from "../../utils/apiKey";
import { formatTable } from "../../utils/formatting";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";

export interface ListGatewayBudgetsOptions {
  scopeType?: string;
}

const SCOPE_KINDS: BudgetScopeKind[] = [
  "ORGANIZATION",
  "TEAM",
  "PROJECT",
  "VIRTUAL_KEY",
  "PRINCIPAL",
  "GROUP",
];

/**
 * Returns the listing rather than printing it: the output port renders it in
 * whatever format the caller asked for (utils/output.ts). `data` is the raw
 * budget list plus the server's spend_available flag, so a machine caller
 * keeps the full scope ids the table truncates, the exact decimal amounts it
 * rounds, and the honesty signal about whether spend was totalled at all.
 */
export const listGatewayBudgetsCommand = async (
  options: ListGatewayBudgetsOptions = {},
): Promise<CommandResult | void> => {
  await resolveCredentials();

  let scopeTypes: BudgetScopeKind[] | undefined;
  if (options.scopeType) {
    const requested = options.scopeType
      .split(",")
      .map((s) => s.trim().toUpperCase().replace(/-/g, "_"));
    const invalid = requested.filter(
      (s) => !(SCOPE_KINDS as readonly string[]).includes(s),
    );
    if (invalid.length > 0) {
      console.error(
        chalk.red(
          `Error: --scope-type must be a comma-separated subset of ${SCOPE_KINDS.map((s) => s.toLowerCase()).join(", ")}`,
        ),
      );
      process.exit(1);
    }
    scopeTypes = requested as BudgetScopeKind[];
  }

  const service = new GatewayBudgetsApiService();
  const spinner = createSpinner("Fetching gateway budgets...").start();

  try {
    const { budgets, spend_available } = await service.list({ scopeTypes });

    spinner.succeed(`Found ${budgets.length} budget${budgets.length !== 1 ? "s" : ""}`);

    return {
      data: { budgets, spend_available },
      table: () => {
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
          // GROUP rows: limit is the PER-MEMBER allowance while spent sums
          // the whole group, so utilization compares against limit x members.
          const isGroup = b.scope_type === "GROUP";
          const effectiveLimit = isGroup ? limit * (b.member_count ?? 0) : limit;
          // A zero effective limit admits no spend at all: maximally
          // breached, not 0% utilized (matches `langwatch status`).
          const pct = effectiveLimit > 0 ? (spent / effectiveLimit) * 100 : 100;
          const pctLabel = `${pct.toFixed(0)}%`;
          const coloredPct = pct >= 100 ? chalk.red(pctLabel) : pct >= 80 ? chalk.yellow(pctLabel) : chalk.green(pctLabel);
          const spentLabel = spend_available
            ? `$${spent.toFixed(2)} (${coloredPct})`
            : chalk.gray("unavailable");
          return {
            ID: b.id,
            Name: b.name,
            Scope: `${b.scope_type.toLowerCase()}:${b.scope_id.slice(0, 10)}...`,
            Window: b.window.toLowerCase(),
            Breach: b.on_breach === "BLOCK" ? chalk.red("block") : chalk.yellow("warn"),
            Limit: isGroup
              ? `$${limit.toFixed(2)}/member x${b.member_count ?? 0}`
              : `$${limit.toFixed(2)}`,
            Spent: spentLabel,
            Provider: b.provider_key ?? chalk.gray("all"),
            Resets: new Date(b.resets_at).toLocaleString(),
            Archived: b.archived_at ? chalk.gray("yes") : "",
          };
        });

        formatTable({
          data: tableData,
          headers: ["ID", "Name", "Scope", "Window", "Breach", "Limit", "Spent", "Provider", "Resets", "Archived"],
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

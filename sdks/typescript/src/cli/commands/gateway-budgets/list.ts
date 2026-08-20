import chalk from "chalk";
import {
  type BudgetScopeKind,
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
    // The flag stays case-insensitive and accepts dashes for the human
    // typing it; the query param is always lowercase snake_case.
    const requested = options.scopeType
      .split(",")
      .map((s) => s.trim().toLowerCase().replace(/-/g, "_"));
    const invalid = requested.filter(
      (s) => !(SCOPE_KINDS as readonly string[]).includes(s),
    );
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

    spinner.succeed(
      `Found ${budgets.length} budget${budgets.length !== 1 ? "s" : ""}`,
    );

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

        const tableData = budgets.map((b) => {
          const limit = Number.parseFloat(b.limit_usd);
          // Null spend means it could not be totalled. Parsing null as 0
          // would render an unknown as a confident "$0.00 spent".
          const spent =
            b.spent_usd === null ? Number.NaN : Number.parseFloat(b.spent_usd);
          // `group` rows: limit is the PER-MEMBER allowance while spent sums
          // the whole group, so utilization compares against limit x members.
          const isGroup = b.scope_type === "group";
          // `attributed_user` rows: the limit belongs to each end user
          // separately, so there is no total to be a percentage of. The
          // standing is a headcount of who has passed their own cap.
          const isPerPerson = b.scope_type === "attributed_user";
          const seatsSeen = b.end_users_seen ?? 0;
          const seatsOver = b.end_users_over ?? 0;
          const effectiveLimit = isGroup
            ? limit * (b.member_count ?? 0)
            : limit;
          // A zero effective limit admits no spend at all: maximally
          // breached, not 0% utilized (matches `langwatch status`).
          const pct = effectiveLimit > 0 ? (spent / effectiveLimit) * 100 : 100;
          const pctLabel = `${pct.toFixed(0)}%`;
          const coloredPct =
            pct >= 100
              ? chalk.red(pctLabel)
              : pct >= 80
                ? chalk.yellow(pctLabel)
                : chalk.green(pctLabel);
          const seatsLabel = `${seatsOver} of ${seatsSeen} over cap`;
          const spentLabel = !spend_available
            ? chalk.gray("unavailable")
            : isPerPerson
              ? seatsOver > 0
                ? chalk.red(seatsLabel)
                : chalk.green(seatsLabel)
              : `$${spent.toFixed(2)} (${coloredPct})`;
          return {
            ID: b.id,
            Name: b.name,
            Scope: `${b.scope_type}:${b.scope_id.slice(0, 10)}...`,
            Window: b.window,
            Breach:
              b.on_breach === "block"
                ? chalk.red("block")
                : chalk.yellow("warn"),
            Limit: isGroup
              ? `$${limit.toFixed(2)}/member x${b.member_count ?? 0}`
              : isPerPerson
                ? `$${limit.toFixed(2)}/person`
                : `$${limit.toFixed(2)}`,
            Spent: spentLabel,
            Provider: b.provider_key ?? chalk.gray("all"),
            Resets: new Date(b.resets_at).toLocaleString(),
            Archived: b.archived_at ? chalk.gray("yes") : "",
          };
        });

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

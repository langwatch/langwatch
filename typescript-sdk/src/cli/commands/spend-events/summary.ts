import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { SpendEventsApiService } from "@/client-sdk/services/spend-events/spend-events-api.service";
import { checkOrgApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";
import { parseInstantOrNull } from "../../utils/instant";

const parseInstant = (value: string, flag: string): number => {
  const parsed = parseInstantOrNull(value);
  if (parsed === null) {
    console.error(chalk.red(`Invalid ${flag} value: ${value}`));
    process.exit(1);
  }
  return parsed;
};

export const spendSummaryCommand = async (options: {
  groupBy?: string;
  from?: string;
  to?: string;
  project?: string;
  limit?: string;
}): Promise<CommandResult | void> => {
  const apiKey = checkOrgApiKey();
  const groupBy = options.groupBy === "end_user" ? "end_user" : "virtual_key";
  const now = Date.now();
  const fromMs =
    options.from !== undefined
      ? parseInstant(options.from, "--from")
      : now - 24 * 60 * 60 * 1000;
  const toMs =
    options.to !== undefined ? parseInstant(options.to, "--to") : now;
  const service = new SpendEventsApiService({ apiKey });
  const spinner = createSpinner("Reading spend summaries...").start();
  try {
    const { data } = await service.summaries({
      groupBy,
      from: fromMs,
      to: toMs,
      projectId: options.project,
      limit: options.limit !== undefined ? Number(options.limit) : undefined,
    });
    const settled = data.reduce((sum, row) => sum + row.settled_count, 0);
    spinner.succeed(
      `${data.length} ${groupBy === "virtual_key" ? "keys" : "end users"}${settled > 0 ? chalk.yellow(`, ${settled} settled request${settled !== 1 ? "s" : ""} unpriced`) : ""}`,
    );
    return {
      data,
      table: () => {
        console.log();
        for (const row of data) {
          const settledNote =
            row.settled_count > 0
              ? chalk.yellow(` (+${row.settled_count} settled, unpriced)`)
              : "";
          console.log(
            `${chalk.cyan(row.key || "(unattributed)")}  $${Number(row.cost.total_usd).toFixed(6)}  ${row.event_count} events${settledNote}  in ${row.usage.input_tokens} / out ${row.usage.output_tokens}`,
          );
        }
        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "read spend summaries" });
    process.exit(1);
  }
};

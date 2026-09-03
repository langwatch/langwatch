import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { SpendEventsApiService } from "@/client-sdk/services/spend-events/spend-events-api.service";
import { checkOrgApiKey } from "../../utils/apiKey";
import { formatTable } from "../../utils/formatting";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";

import { parseInstantOrNull } from "../../utils/instant";

const parsePositiveInt = (value: string, flag: string): number => {
  const parsed = Number(value);
  if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;
  console.error(`Invalid ${flag}: pass a positive integer.`);
  process.exit(1);
};

const parseInstant = (value: string, flag: string): number => {
  const parsed = parseInstantOrNull(value);
  if (parsed !== null) return parsed;
  console.error(`Invalid ${flag}: pass an ISO-8601 instant or epoch milliseconds.`);
  process.exit(1);
};

export const listSpendEventsCommand = async (options: {
  from?: string;
  to?: string;
  cursor?: string;
  limit?: string;
  virtualKey?: string;
  endUser?: string;
  project?: string;
  model?: string;
  status?: "success" | "error";
}): Promise<CommandResult | void> => {
  const apiKey = checkOrgApiKey();
  // Parse flags before the spinner starts: bad input must produce a clean
  // structured error, not frames interleaved with a dying spinner.
  // The pull is a ranged read by contract; default to the last 24 hours.
  const now = Date.now();
  const from =
    options.from !== undefined ? parseInstant(options.from, "--from") : now - 24 * 60 * 60 * 1000;
  const to = options.to !== undefined ? parseInstant(options.to, "--to") : now;
  const limit =
    options.limit !== undefined ? parsePositiveInt(options.limit, "--limit") : undefined;
  const service = new SpendEventsApiService({ apiKey });
  const spinner = createSpinner("Fetching spend events...").start();
  try {
    const page = await service.listPage({
      from,
      to,
      cursor: options.cursor,
      limit,
      virtualKeyId: options.virtualKey,
      endUserId: options.endUser,
      projectId: options.project,
      model: options.model,
      status: options.status,
    });
    spinner.succeed(
      `${page.data.length} event${page.data.length !== 1 ? "s" : ""}${page.next_cursor ? " (more available)" : ""}`,
    );
    return {
      data: page,
      table: () => {
        if (page.data.length === 0) {
          console.log();
          console.log(chalk.gray("No spend events in range."));
          return;
        }
        console.log();
        formatTable({
          // Settled events carry null usage and cost: unknown is not zero,
          // so the table says so instead of printing 0.
          data: page.data.map((e) => ({
            "Request id": e.data.gateway_request_id,
            "Occurred at": new Date(e.data.occurred_at).toLocaleString(),
            Model: e.data.model ?? chalk.gray("-"),
            "End user": e.data.end_user_id ?? chalk.gray("-"),
            "In/Out": e.data.usage
              ? `${e.data.usage.input_tokens}/${e.data.usage.output_tokens}`
              : chalk.gray("?"),
            "Cache r/w": e.data.usage
              ? `${e.data.usage.cache_read_input_tokens}/${e.data.usage.cache_creation_input_tokens}`
              : chalk.gray("?"),
            "Cost USD": e.data.cost?.total_usd ?? chalk.yellow("unknown"),
            Status:
              e.data.status === "success"
                ? chalk.green("success")
                : e.data.status === "settled"
                  ? chalk.yellow("settled")
                  : chalk.red(e.data.error?.class ?? "error"),
          })),
          headers: [
            "Request id",
            "Occurred at",
            "Model",
            "End user",
            "In/Out",
            "Cache r/w",
            "Cost USD",
            "Status",
          ],
          colorMap: { "Request id": chalk.gray, Model: chalk.cyan },
        });
        if (page.next_cursor) {
          console.log();
          console.log(chalk.gray(`Next page: --cursor '${page.next_cursor}'`));
        }
        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch spend events" });
    process.exit(1);
  }
};

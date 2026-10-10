import chalk from "chalk";

import { SpendEventsApiService } from "@/client-sdk/services/spend-events/spend-events-api.service";

import { checkOrgApiKey } from "../../utils/apiKey";
import { formatTable } from "../../utils/formatting";
import { parseInstantOrNull } from "../../utils/instant";
import type { CommandResult } from "../../utils/output";
import { createSpinner } from "../../utils/spinner";
import { failSpinner } from "../../utils/spinnerError";

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

const formatSpendEventStatus = (status: string, errorClass: string | undefined): string => {
  if (status === "success") return chalk.green("success");
  if (status === "settled") return chalk.yellow("settled");
  return chalk.red(errorClass ?? "error");
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
      table: () => printSpendEvents(page),
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch spend events" });
    process.exit(1);
  }
};

function printSpendEvents(page: Awaited<ReturnType<SpendEventsApiService["listPage"]>>): void {
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
      // Image tokens are priced separately from the text buckets, so an
      // image request shows its quantities here and 0 out under In/Out.
      "Image in/out": e.data.usage
        ? `${e.data.usage.input_image_tokens}/${e.data.usage.output_image_tokens}`
        : chalk.gray("?"),
      Images: e.data.usage ? `${e.data.usage.image_count}` : chalk.gray("?"),
      "Cost USD": e.data.cost?.total_usd ?? chalk.yellow("unknown"),
      Status: formatSpendEventStatus(e.data.status, e.data.error?.class),
    })),
    headers: [
      "Request id",
      "Occurred at",
      "Model",
      "End user",
      "In/Out",
      "Cache r/w",
      "Image in/out",
      "Images",
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
}

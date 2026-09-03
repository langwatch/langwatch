import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { WebhooksApiService } from "@/client-sdk/services/webhooks/webhooks-api.service";
import { checkOrgApiKey } from "../../utils/apiKey";
import { formatTable } from "../../utils/formatting";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";

import { parseInstantOrNull } from "../../utils/instant";

const parseInstant = ({ value, flag }: { value: string; flag: string }): number => {
  const parsed = parseInstantOrNull(value);
  if (parsed !== null) return parsed;
  console.error(`Invalid ${flag}: pass an ISO-8601 instant or epoch milliseconds.`);
  process.exit(1);
};

export const webhookEventsCommand = async (options: {
  type?: string;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: string;
}): Promise<CommandResult | void> => {
  const apiKey = checkOrgApiKey();
  // Parse flags before the spinner starts: bad input must produce a clean
  // structured error, not frames interleaved with a dying spinner.
  // The log is a ranged read by contract; default to the 24 hours before
  // whatever `to` resolved to, so `--to` alone reads the day before the
  // instant the caller named rather than a range ending before it starts.
  const to =
    options.to !== undefined
      ? parseInstant({ value: options.to, flag: "--to" })
      : Date.now();
  const from =
    options.from !== undefined
      ? parseInstant({ value: options.from, flag: "--from" })
      : to - 24 * 60 * 60 * 1000;
  const service = new WebhooksApiService({ apiKey });
  const spinner = createSpinner("Fetching emitted events...").start();
  try {
    const page = await service.eventsPage({
      type: options.type,
      from,
      to,
      cursor: options.cursor,
      limit: options.limit !== undefined ? Number(options.limit) : undefined,
    });
    spinner.succeed(
      `${page.data.length} event${page.data.length !== 1 ? "s" : ""}${page.next_cursor ? " (more available)" : ""}`,
    );
    return {
      data: page,
      table: () => {
        if (page.data.length === 0) {
          console.log();
          console.log(chalk.gray("No events in range."));
          return;
        }
        console.log();
        formatTable({
          data: page.data.map((e) => ({
            ID: e.id,
            Type: e.type,
            Created: new Date(e.created).toLocaleString(),
          })),
          headers: ["ID", "Type", "Created"],
          colorMap: { ID: chalk.gray, Type: chalk.cyan },
        });
        if (page.next_cursor) {
          console.log();
          console.log(chalk.gray(`Next page: --cursor '${page.next_cursor}'`));
        }
        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch emitted events" });
    process.exit(1);
  }
};

export const webhookEventTypesCommand = async (): Promise<CommandResult | void> => {
  const apiKey = checkOrgApiKey();
  const service = new WebhooksApiService({ apiKey });
  const spinner = createSpinner("Fetching event catalog...").start();
  try {
    const types = await service.eventTypes();
    spinner.succeed(`${types.length} event type${types.length !== 1 ? "s" : ""}`);
    return {
      data: types,
      table: () => {
        console.log();
        formatTable({
          data: types.map((t) => ({
            Type: t.type,
            Family: t.family,
            Emitting: t.is_emitting ? chalk.green("yes") : chalk.gray("declared"),
            Description:
              t.description.length > 50
                ? `${t.description.slice(0, 47)}...`
                : t.description,
          })),
          headers: ["Type", "Family", "Emitting", "Description"],
          colorMap: { Type: chalk.cyan },
        });
        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch event catalog" });
    process.exit(1);
  }
};

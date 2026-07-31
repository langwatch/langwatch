import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { WebhooksApiService } from "@/client-sdk/services/webhooks/webhooks-api.service";
import { checkOrgApiKey } from "../../utils/apiKey";
import { formatTable } from "../../utils/formatting";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";

export const webhookEventsCommand = async (options: {
  type?: string;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: string;
}): Promise<CommandResult | void> => {
  const apiKey = checkOrgApiKey();
  const service = new WebhooksApiService({ apiKey });
  const spinner = createSpinner("Fetching emitted events...").start();
  try {
    const parseInstantValue = (value: string): number => {
      const parsed = Date.parse(value);
      return Number.isNaN(parsed) ? Number(value) : parsed;
    };
    const page = await service.events({
      type: options.type,
      from: options.from !== undefined ? parseInstantValue(options.from) : undefined,
      to: options.to !== undefined ? parseInstantValue(options.to) : undefined,
      cursor: options.cursor,
      limit: options.limit !== undefined ? Number(options.limit) : undefined,
    });
    spinner.succeed(`${page.data.length} event${page.data.length !== 1 ? "s" : ""}${page.next_cursor ? " (more available)" : ""}`);
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
            Description: t.description.length > 50 ? `${t.description.slice(0, 47)}...` : t.description,
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

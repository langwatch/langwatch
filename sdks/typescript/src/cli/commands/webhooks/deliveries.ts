import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { WebhooksApiService } from "@/client-sdk/services/webhooks/webhooks-api.service";
import { checkOrgApiKey } from "../../utils/apiKey";
import { formatTable } from "../../utils/formatting";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";

/**
 * The most recent delivery attempts for one endpoint, one page at a time.
 *
 * The log grows with every send and has no bound worth printing to a
 * terminal, so `--limit` is the page size and `--cursor` walks backwards
 * through the history rather than the command collecting all of it.
 */
export const webhookDeliveriesCommand = async (
  id: string,
  options: { cursor?: string; limit?: string },
): Promise<CommandResult | void> => {
  const apiKey = checkOrgApiKey();
  const service = new WebhooksApiService({ apiKey });
  const spinner = createSpinner("Fetching delivery log...").start();
  try {
    const page = await service.deliveriesPage(id, {
      cursor: options.cursor,
      limit: options.limit !== undefined ? Number(options.limit) : undefined,
    });
    const deliveries = page.data;
    spinner.succeed(
      `${deliveries.length} attempt${deliveries.length !== 1 ? "s" : ""}${page.next_cursor ? " (more available)" : ""}`,
    );
    return {
      data: page,
      table: () => {
        if (deliveries.length === 0) {
          console.log();
          console.log(chalk.gray("No deliveries recorded yet."));
          return;
        }
        console.log();
        formatTable({
          data: deliveries.map((d) => ({
            "Fired at": new Date(d.fired_at).toLocaleString(),
            Attempt: String(d.attempt),
            Events: String(d.event_count),
            Outcome:
              d.outcome === "success"
                ? chalk.green(d.outcome)
                : d.outcome === "retryable"
                  ? chalk.yellow(d.outcome)
                  : chalk.red(d.outcome),
            Status: d.response_status !== null ? String(d.response_status) : chalk.gray("-"),
            "Latency ms": d.latency_ms !== null ? String(d.latency_ms) : chalk.gray("-"),
            Error: d.error ? (d.error.length > 40 ? `${d.error.slice(0, 37)}...` : d.error) : "",
          })),
          headers: ["Fired at", "Attempt", "Events", "Outcome", "Status", "Latency ms", "Error"],
        });
        if (page.next_cursor) {
          console.log();
          console.log(chalk.gray(`Next page: --cursor '${page.next_cursor}'`));
        }
        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch webhook deliveries" });
    process.exit(1);
  }
};

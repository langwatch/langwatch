import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { WebhooksApiService } from "@/client-sdk/services/webhooks/webhooks-api.service";
import { checkOrgApiKey } from "../../utils/apiKey";
import { formatTable } from "../../utils/formatting";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";

export const listWebhooksCommand = async (): Promise<CommandResult | void> => {
  const apiKey = checkOrgApiKey();
  const service = new WebhooksApiService({ apiKey });
  const spinner = createSpinner("Fetching webhook endpoints...").start();
  try {
    const endpoints = await service.list();
    spinner.succeed(`Found ${endpoints.length} endpoint${endpoints.length !== 1 ? "s" : ""}`);
    return {
      data: endpoints,
      table: () => {
        if (endpoints.length === 0) {
          console.log();
          console.log(chalk.gray("No webhook endpoints configured."));
          console.log(chalk.gray("Create one with:"));
          console.log(
            chalk.cyan(
              '  langwatch webhooks create --url https://example.com/hooks --events "gateway.request.completed"',
            ),
          );
          return;
        }
        console.log();
        // A queue endpoint has no URL, so the column reads whichever address
        // the endpoint actually delivers to.
        const address = (e: (typeof endpoints)[number]) => e.sqs?.queue_url ?? e.url ?? "";
        formatTable({
          data: endpoints.map((e) => ({
            ID: e.id,
            Destination: e.destination_kind === "sqs" ? "Amazon SQS" : "HTTPS",
            Address: address(e).length > 45 ? `${address(e).slice(0, 42)}...` : address(e),
            Status:
              e.status === "active"
                ? chalk.green("active")
                : chalk.red(`disabled${e.disabled_reason ? ` (${e.disabled_reason})` : ""}`),
            Events:
              e.enabled_events.length > 2
                ? `${e.enabled_events.slice(0, 2).join(", ")} +${e.enabled_events.length - 2}`
                : e.enabled_events.join(", "),
            "Last success": e.last_success_at
              ? new Date(e.last_success_at).toLocaleString()
              : chalk.gray("never"),
          })),
          headers: ["ID", "Destination", "Address", "Status", "Events", "Last success"],
          colorMap: { ID: chalk.gray, Address: chalk.cyan },
        });
        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch webhook endpoints" });
    process.exit(1);
  }
};

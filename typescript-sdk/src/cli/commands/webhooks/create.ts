import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { WebhooksApiService } from "@/client-sdk/services/webhooks/webhooks-api.service";
import { checkOrgApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";

export const createWebhookCommand = async (options: {
  url: string;
  events: string;
}): Promise<CommandResult | void> => {
  const apiKey = checkOrgApiKey();
  const service = new WebhooksApiService({ apiKey });
  const spinner = createSpinner("Creating webhook endpoint...").start();
  try {
    const endpoint = await service.create({
      url: options.url,
      enabledEvents: options.events.split(",").map((e) => e.trim()).filter(Boolean),
    });
    spinner.succeed(`Created endpoint ${endpoint.id}`);
    return {
      data: endpoint,
      table: () => {
        console.log();
        console.log(chalk.yellow("Signing secret (shown ONCE, store it now):"));
        console.log(chalk.cyan(`  ${endpoint.secret}`));
        console.log();
        console.log(chalk.gray("Verify deliveries with the X-LangWatch-Signature header (t=,v1= HMAC-SHA256, 5-minute tolerance)."));
        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "create webhook endpoint" });
    process.exit(1);
  }
};

import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { WebhooksApiService } from "@/client-sdk/services/webhooks/webhooks-api.service";
import { checkOrgApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";

export const rollWebhookSecretCommand = async (
  id: string,
): Promise<CommandResult | void> => {
  const apiKey = checkOrgApiKey();
  const service = new WebhooksApiService({ apiKey });
  const spinner = createSpinner("Rolling signing secret...").start();
  try {
    const endpoint = await service.rollSecret(id);
    spinner.succeed(
      `Secret rolled for ${endpoint.id}; deliveries sign with it immediately`,
    );
    return {
      data: endpoint,
      table: () => {
        console.log();
        console.log(chalk.yellow("New signing secret (shown ONCE):"));
        console.log(chalk.cyan(`  ${endpoint.secret}`));
        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "roll webhook secret" });
    process.exit(1);
  }
};

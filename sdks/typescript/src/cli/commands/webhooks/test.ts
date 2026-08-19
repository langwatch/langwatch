import chalk from "chalk";
import { WebhooksApiService } from "@/client-sdk/services/webhooks/webhooks-api.service";
import { checkOrgApiKey } from "../../utils/apiKey";
import type { CommandResult } from "../../utils/output";
import { createSpinner } from "../../utils/spinner";
import { failSpinner } from "../../utils/spinnerError";

export const testWebhookCommand = async (
  id: string,
): Promise<CommandResult | void> => {
  const apiKey = checkOrgApiKey();
  const service = new WebhooksApiService({ apiKey });
  const spinner = createSpinner("Sending signed test event...").start();
  try {
    const result = await service.test(id);
    if (result.delivered) {
      spinner.succeed(`Receiver answered ${result.response_status}`);
    } else {
      spinner.warn(
        `Delivery failed${result.response_status !== null ? ` (HTTP ${result.response_status})` : ""}${result.error ? `: ${result.error}` : ""}`,
      );
      // Scripts read the exit code; a rejected test delivery is a failure.
      // exitCode (not exit) so the structured payload still prints.
      process.exitCode = 1;
    }
    return {
      data: result,
      table: () => {
        if (result.response_body) {
          console.log();
          console.log(chalk.gray("Response body (truncated):"));
          console.log(`  ${result.response_body}`);
          console.log();
        }
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "test webhook endpoint" });
    process.exit(1);
  }
};

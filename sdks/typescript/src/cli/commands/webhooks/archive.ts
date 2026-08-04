import { createSpinner } from "../../utils/spinner";
import { WebhooksApiService } from "@/client-sdk/services/webhooks/webhooks-api.service";
import { checkOrgApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";

export const archiveWebhookCommand = async (id: string): Promise<CommandResult | void> => {
  const apiKey = checkOrgApiKey();
  const service = new WebhooksApiService({ apiKey });
  const spinner = createSpinner("Archiving webhook endpoint...").start();
  try {
    await service.archive(id);
    spinner.succeed(`Endpoint ${id} archived`);
    return {
      data: { id, archived: true },
      table: () => {
        console.log();
        console.log(`Endpoint ${id} archived.`);
        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "archive webhook endpoint" });
    process.exit(1);
  }
};

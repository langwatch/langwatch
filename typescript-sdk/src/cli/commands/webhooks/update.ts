import { createSpinner } from "../../utils/spinner";
import { WebhooksApiService } from "@/client-sdk/services/webhooks/webhooks-api.service";
import { checkOrgApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";

export const updateWebhookCommand = async (
  id: string,
  options: {
    url?: string;
    events?: string;
    maxBatchSize?: string;
    maxBatchDelay?: string;
    maxInFlight?: string;
  },
): Promise<CommandResult | void> => {
  const apiKey = checkOrgApiKey();
  const service = new WebhooksApiService({ apiKey });
  const spinner = createSpinner("Updating webhook endpoint...").start();
  try {
    const endpoint = await service.update(id, {
      url: options.url,
      maxBatchSize:
        options.maxBatchSize !== undefined
          ? Number(options.maxBatchSize)
          : undefined,
      maxBatchDelayMs:
        options.maxBatchDelay !== undefined
          ? Number(options.maxBatchDelay)
          : undefined,
      maxInFlight:
        options.maxInFlight !== undefined
          ? Number(options.maxInFlight)
          : undefined,
      enabledEvents: options.events !== undefined
        ? options.events.split(",").map((e) => e.trim()).filter(Boolean)
        : undefined,
    });
    spinner.succeed(`Updated endpoint ${endpoint.id}`);
    return { data: endpoint, table: () => {} };
  } catch (error) {
    failSpinner({ spinner, error, action: "update webhook endpoint" });
    process.exit(1);
  }
};

export const enableWebhookCommand = async (id: string): Promise<CommandResult | void> => {
  const apiKey = checkOrgApiKey();
  const service = new WebhooksApiService({ apiKey });
  const spinner = createSpinner("Enabling webhook endpoint...").start();
  try {
    const endpoint = await service.update(id, { status: "ACTIVE" });
    spinner.succeed(`Endpoint ${endpoint.id} is active`);
    return { data: endpoint, table: () => {} };
  } catch (error) {
    failSpinner({ spinner, error, action: "enable webhook endpoint" });
    process.exit(1);
  }
};

export const disableWebhookCommand = async (id: string): Promise<CommandResult | void> => {
  const apiKey = checkOrgApiKey();
  const service = new WebhooksApiService({ apiKey });
  const spinner = createSpinner("Disabling webhook endpoint...").start();
  try {
    const endpoint = await service.update(id, { status: "DISABLED" });
    spinner.succeed(`Endpoint ${endpoint.id} disabled (deliveries drain without sending)`);
    return { data: endpoint, table: () => {} };
  } catch (error) {
    failSpinner({ spinner, error, action: "disable webhook endpoint" });
    process.exit(1);
  }
};

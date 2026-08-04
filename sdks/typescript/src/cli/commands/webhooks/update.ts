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
  if (
    options.url === undefined &&
    options.events === undefined &&
    options.maxBatchSize === undefined &&
    options.maxBatchDelay === undefined &&
    options.maxInFlight === undefined
  ) {
    console.error(
      "Nothing to update: pass at least one of --url, --events, --max-batch-size, --max-batch-delay, --max-in-flight.",
    );
    process.exit(1);
  }
  // Number("abc") is NaN and JSON.stringify turns NaN into null, so loose
  // parsing here would ship a null patch the server cannot bound-check.
  const parseIntOption = (
    value: string | undefined,
    flag: string,
  ): number | undefined => {
    if (value === undefined) return undefined;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || value.trim() === "") {
      console.error(`Invalid ${flag} value: ${value} (expected an integer)`);
      process.exit(1);
    }
    return parsed;
  };
  const maxBatchSize = parseIntOption(options.maxBatchSize, "--max-batch-size");
  const maxBatchDelayMs = parseIntOption(
    options.maxBatchDelay,
    "--max-batch-delay",
  );
  const maxInFlight = parseIntOption(options.maxInFlight, "--max-in-flight");
  const service = new WebhooksApiService({ apiKey });
  const spinner = createSpinner("Updating webhook endpoint...").start();
  try {
    const endpoint = await service.update(id, {
      url: options.url,
      maxBatchSize,
      maxBatchDelayMs,
      maxInFlight,
      enabledEvents: options.events !== undefined
        ? options.events.split(",").map((e) => e.trim()).filter(Boolean)
        : undefined,
    });
    spinner.succeed(`Updated endpoint ${endpoint.id}`);
    return {
      data: endpoint,
      table: () => {
        console.log();
        console.log(`Endpoint:    ${endpoint.id}`);
        console.log(`URL:         ${endpoint.url}`);
        console.log(`Events:      ${endpoint.enabled_events.join(", ")}`);
        console.log(`Delivery:    batch<=${endpoint.max_batch_size}, delay ${endpoint.max_batch_delay_ms}ms, in-flight<=${endpoint.max_in_flight}`);
        console.log();
      },
    };
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
    const endpoint = await service.update(id, { status: "active" });
    spinner.succeed(`Endpoint ${endpoint.id} is active`);
    return {
      data: endpoint,
      table: () => {
        console.log();
        console.log(`Endpoint ${endpoint.id} is active again. Replay the gap window if the pause left undelivered events.`);
        console.log();
      },
    };
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
    const endpoint = await service.update(id, { status: "disabled" });
    spinner.succeed(`Endpoint ${endpoint.id} disabled (deliveries drain without sending)`);
    return {
      data: endpoint,
      table: () => {
        console.log();
        console.log(`Endpoint ${endpoint.id} is disabled. Events keep accruing; re-enable and replay to catch up.`);
        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "disable webhook endpoint" });
    process.exit(1);
  }
};

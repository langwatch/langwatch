import { createSpinner } from "../../utils/spinner";
import { SQS_SECRET_ENV, sqsSecretFromEnv } from "./create";
import { WebhooksApiService } from "@/client-sdk/services/webhooks/webhooks-api.service";
import { checkOrgApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";

export const updateWebhookCommand = async (
  id: string,
  options: {
    url?: string;
    queueUrl?: string;
    roleArn?: string;
    accessKeyId?: string;
    events?: string;
    maxBatchSize?: string;
    maxBatchDelay?: string;
    maxInFlight?: string;
  },
): Promise<CommandResult | void> => {
  const apiKey = checkOrgApiKey();
  // The secret is read from the environment, never from an argument: an
  // argument lands in shell history, in ps output, and in CI logs.
  const secretAccessKey = sqsSecretFromEnv();
  if (options.accessKeyId !== undefined && !secretAccessKey) {
    console.error(
      `--access-key-id needs its secret in ${SQS_SECRET_ENV}. A secret passed as an argument ends up in shell history, in ps output, and in CI logs.`,
    );
    process.exit(1);
  }
  const sqsFields = {
    ...(options.queueUrl !== undefined ? { queue_url: options.queueUrl } : {}),
    ...(options.roleArn !== undefined ? { role_arn: options.roleArn } : {}),
    ...(options.accessKeyId !== undefined
      ? { access_key_id: options.accessKeyId, secret_access_key: secretAccessKey }
      : {}),
  };
  if (
    options.url === undefined &&
    Object.keys(sqsFields).length === 0 &&
    options.events === undefined &&
    options.maxBatchSize === undefined &&
    options.maxBatchDelay === undefined &&
    options.maxInFlight === undefined
  ) {
    console.error(
      "Nothing to update: pass at least one of --url, --queue-url, --role-arn, --access-key-id, --secret-access-key, --events, --max-batch-size, --max-batch-delay, --max-in-flight.",
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
      // An endpoint keeps the destination it was created with, so these only
      // ever adjust a queue endpoint's own queue and credentials.
      ...(Object.keys(sqsFields).length > 0 ? { sqs: sqsFields } : {}),
      max_batch_size: maxBatchSize,
      max_batch_delay_ms: maxBatchDelayMs,
      max_in_flight: maxInFlight,
      enabled_events: options.events !== undefined
        ? options.events.split(",").map((e) => e.trim()).filter(Boolean)
        : undefined,
    });
    spinner.succeed(`Updated endpoint ${endpoint.id}`);
    return {
      data: endpoint,
      table: () => {
        console.log();
        console.log(`Endpoint:    ${endpoint.id}`);
        // A queue endpoint has no URL, so printing `url` alone would show
        // "null" right after a successful queue change.
        console.log(
          endpoint.destination_kind === "sqs"
            ? `Queue URL:   ${endpoint.sqs?.queue_url ?? ""}`
            : `URL:         ${endpoint.url}`,
        );
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

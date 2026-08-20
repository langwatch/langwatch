import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import type {
  WebhookDestinationInput,
  WebhookSqsDestinationInput,
} from "@/client-sdk/services/webhooks/webhooks-api.service";
import { WebhooksApiService } from "@/client-sdk/services/webhooks/webhooks-api.service";
import { checkOrgApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";

export interface CreateWebhookOptions {
  url?: string;
  queueUrl?: string;
  roleArn?: string;
  accessKeyId?: string;
  events: string;
}

/**
 * The queue's secret access key, which is never a flag.
 *
 * An argument lands in shell history, in `ps` output for every user on the
 * box, and in CI command logs. A long-lived AWS secret does not go there, so
 * it is read from the environment instead and the flag that would have
 * carried it does not exist.
 */
export const SQS_SECRET_ENV = "LANGWATCH_SQS_SECRET_ACCESS_KEY";

export function sqsSecretFromEnv(): string | undefined {
  const secret = process.env[SQS_SECRET_ENV]?.trim();
  // A variable set to whitespace is a variable someone meant to fill in, so
  // it reads as absent rather than as a secret that will fail at AWS.
  return secret === "" ? undefined : secret;
}

/**
 * Which destination the flags describe, and its fields.
 *
 * Naming a queue is what selects the queue destination: there is no separate
 * kind flag to keep in agreement with the address, so the two can never
 * disagree.
 */
export function destinationFromOptions(
  options: CreateWebhookOptions,
): WebhookDestinationInput {
  if (options.queueUrl) {
    if (options.url) {
      throw new Error(
        "Pass --url or --queue-url, not both: an endpoint delivers to one destination.",
      );
    }
    const sqs: WebhookSqsDestinationInput = { queue_url: options.queueUrl };
    if (options.roleArn) sqs.role_arn = options.roleArn;
    if (options.accessKeyId) {
      const secret = sqsSecretFromEnv();
      if (!secret) {
        throw new Error(
          `--access-key-id needs its secret in ${SQS_SECRET_ENV}. A secret passed as an argument ends up in shell history, in ps output, and in CI logs.`,
        );
      }
      sqs.access_key_id = options.accessKeyId;
      sqs.secret_access_key = secret;
    }
    return { destination_kind: "sqs", sqs };
  }
  // A queue flag without --queue-url describes a destination that was never
  // selected, so it is a mistake rather than something to ignore.
  const strayQueueFlags = [
    options.roleArn ? "--role-arn" : "",
    options.accessKeyId ? "--access-key-id" : "",
  ].filter(Boolean);
  if (strayQueueFlags.length > 0) {
    throw new Error(
      `${strayQueueFlags.join(" and ")} only applies to an Amazon SQS destination. Pass --queue-url as well.`,
    );
  }
  if (!options.url) {
    throw new Error("Pass --url for an HTTPS endpoint, or --queue-url for an Amazon SQS queue.");
  }
  return { destination_kind: "http", url: options.url };
}

export const createWebhookCommand = async (
  options: CreateWebhookOptions,
): Promise<CommandResult | void> => {
  const apiKey = checkOrgApiKey();
  const service = new WebhooksApiService({ apiKey });
  const spinner = createSpinner("Creating webhook endpoint...").start();
  try {
    const endpoint = await service.create({
      ...destinationFromOptions(options),
      enabled_events: options.events.split(",").map((e) => e.trim()).filter(Boolean),
    });
    spinner.succeed(`Created endpoint ${endpoint.id}`);
    return {
      data: endpoint,
      table: () => {
        console.log();
        console.log(chalk.yellow("Signing secret (shown ONCE, store it now):"));
        console.log(chalk.cyan(`  ${endpoint.secret}`));
        console.log();
        if (endpoint.sqs?.external_id) {
          console.log(chalk.yellow("External id for the role's trust policy:"));
          console.log(chalk.cyan(`  ${endpoint.sqs.external_id}`));
          console.log(
            chalk.gray(
              `  Trust ${endpoint.sqs.role_arn ?? "the role"} to be assumed by LangWatch with this sts:ExternalId.`,
            ),
          );
          console.log();
        }
        console.log(chalk.gray("Verify deliveries with the X-LangWatch-Signature header (t=,v1= HMAC-SHA256, 5-minute tolerance)."));
        if (endpoint.destination_kind === "sqs") {
          // The one thing every queue consumer gets wrong on its first run.
          console.log(chalk.gray("On a queue, that signature is a MESSAGE ATTRIBUTE: pass MessageAttributeNames: [\"All\"] to ReceiveMessage or you will not see it."));
        }
        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "create webhook endpoint" });
    process.exit(1);
  }
};

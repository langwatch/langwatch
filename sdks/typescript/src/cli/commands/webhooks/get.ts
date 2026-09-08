import { createSpinner } from "../../utils/spinner";
import { WebhooksApiService } from "@/client-sdk/services/webhooks/webhooks-api.service";
import { checkOrgApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";

export const getWebhookCommand = async (id: string): Promise<CommandResult | void> => {
  const apiKey = checkOrgApiKey();
  const service = new WebhooksApiService({ apiKey });
  const spinner = createSpinner("Fetching webhook endpoint...").start();
  try {
    const endpoint = await service.get(id);
    spinner.succeed(`Endpoint ${endpoint.id}`);
    return {
      data: endpoint,
      table: () => {
        console.log();
        console.log(`ID:            ${endpoint.id}`);
        if (endpoint.destination_kind === "sqs" && endpoint.sqs) {
          console.log(`Destination:   Amazon SQS queue`);
          console.log(`Queue URL:     ${endpoint.sqs.queue_url}`);
          console.log(`Region:        ${endpoint.sqs.region}`);
          console.log(`Account:       ${endpoint.sqs.account_id}`);
          console.log(`Credentials:   ${endpoint.sqs.credential_mode}`);
          if (endpoint.sqs.role_arn) {
            console.log(`Role:          ${endpoint.sqs.role_arn}`);
          }
          if (endpoint.sqs.external_id) {
            console.log(`External id:   ${endpoint.sqs.external_id}`);
          }
        } else {
          console.log(`Destination:   HTTPS endpoint`);
          console.log(`URL:           ${endpoint.url}`);
        }
        console.log(`Status:        ${endpoint.status}${endpoint.disabled_reason ? ` (${endpoint.disabled_reason})` : ""}`);
        console.log(`Events:        ${endpoint.enabled_events.join(", ")}`);
        console.log(`Last success:  ${endpoint.last_success_at ?? "never"}`);
        console.log(`Failing since: ${endpoint.failing_since ?? "-"}`);
        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch webhook endpoint" });
    process.exit(1);
  }
};

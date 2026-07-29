import { createSpinner } from "../../utils/spinner";
import { WebhooksApiService } from "@/client-sdk/services/webhooks/webhooks-api.service";
import { checkOrgApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";

export const webhookHealthCommand = async (id: string): Promise<CommandResult | void> => {
  const apiKey = checkOrgApiKey();
  const service = new WebhooksApiService({ apiKey });
  const spinner = createSpinner("Reading endpoint health...").start();
  try {
    const health = await service.health(id);
    spinner.succeed(`Status: ${health.status}${health.disabled_reason ? ` (${health.disabled_reason})` : ""}`);
    return {
      data: health,
      table: () => {
        console.log();
        console.log(`Status:        ${health.status}${health.disabled_reason ? ` (${health.disabled_reason})` : ""}`);
        console.log(`Failing since: ${health.failing_since ?? "-"}`);
        console.log(`Last success:  ${health.last_success_at ?? "never"}`);
        console.log(`Last failure:  ${health.last_failure_at ?? "-"}`);
        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "read webhook health" });
    process.exit(1);
  }
};

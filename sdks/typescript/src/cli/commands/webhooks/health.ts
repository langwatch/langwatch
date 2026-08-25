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
    const lag =
      health.oldest_undelivered_age_ms === null
        ? "caught up"
        : `${Math.round(health.oldest_undelivered_age_ms / 1000)}s behind`;
    spinner.succeed(
      `Lag: ${lag}, status: ${health.status}${health.disabled_reason ? ` (${health.disabled_reason})` : ""}`,
    );
    return {
      data: health,
      table: () => {
        console.log();
        console.log(`Lag:           ${lag}`);
        console.log(`DLQ depth:     ${health.dlq_depth}`);
        console.log(
          `Status:        ${health.status}${health.disabled_reason ? ` (${health.disabled_reason})` : ""}`,
        );
        console.log(`Sends/min:     ${health.sends_per_minute.toFixed(2)}`);
        console.log(
          `Success rate:  ${health.success_rate === null ? "-" : `${Math.round(health.success_rate * 100)}%`}`,
        );
        console.log(
          `p95 latency:   ${health.p95_latency_ms === null ? "-" : `${health.p95_latency_ms}ms`}`,
        );
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

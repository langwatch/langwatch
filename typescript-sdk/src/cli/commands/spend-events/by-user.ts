import { createSpinner } from "../../utils/spinner";
import { SpendEventsApiService } from "@/client-sdk/services/spend-events/spend-events-api.service";
import { checkOrgApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";

export const spendByUserCommand = async (
  endUserId: string,
  options: { window?: "day" | "week" | "month"; virtualKey?: string },
): Promise<CommandResult | void> => {
  const apiKey = checkOrgApiKey();
  const service = new SpendEventsApiService({ apiKey });
  const spinner = createSpinner("Reading end-user spend...").start();
  try {
    const spend = await service.endUserSpend(endUserId, {
      window: options.window,
      virtualKeyId: options.virtualKey,
    });
    spinner.succeed(
      `${spend.end_user_id}: $${Number(spend.cost.total_usd).toFixed(4)} over ${spend.request_count} request${spend.request_count !== 1 ? "s" : ""} (${spend.window})`,
    );
    return {
      data: spend,
      table: () => {
        console.log();
        console.log(`Window:    ${spend.from} .. ${spend.to}`);
        console.log(`Spend:     $${Number(spend.cost.total_usd).toFixed(6)}`);
        console.log(`Requests:  ${spend.request_count}`);
        console.log(`Tokens:    in ${spend.usage.input_tokens} / out ${spend.usage.output_tokens} / cache r ${spend.usage.cache_read_input_tokens} w ${spend.usage.cache_creation_input_tokens}`);
        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "read end-user spend" });
    process.exit(1);
  }
};

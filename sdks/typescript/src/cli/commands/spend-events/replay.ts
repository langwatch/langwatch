import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { SpendEventsApiService } from "@/client-sdk/services/spend-events/spend-events-api.service";
import { checkOrgApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";
import { parseInstantOrNull } from "../../utils/instant";

const parseInstant = (value: string, flag: string): number => {
  const parsed = parseInstantOrNull(value);
  if (parsed === null) {
    console.error(chalk.red(`Invalid ${flag} value: ${value}`));
    process.exit(1);
  }
  return parsed;
};

/**
 * Re-deliver a window's spend envelopes to one endpoint. Envelope ids ride
 * unchanged, so the receiver's event-id dedup decides what a redelivery
 * means; the server caps the window at 7 days per call.
 */
export const spendReplayCommand = async (options: {
  from: string;
  to: string;
  endpoint: string;
}): Promise<CommandResult | void> => {
  const apiKey = checkOrgApiKey();
  const fromMs = parseInstant(options.from, "--from");
  const toMs = parseInstant(options.to, "--to");
  const service = new SpendEventsApiService({ apiKey });
  const spinner = createSpinner("Replaying spend events...").start();
  try {
    const result = await service.replay({
      from: fromMs,
      to: toMs,
      endpointId: options.endpoint,
    });
    spinner.succeed(
      `Replayed ${result.replayed} envelope${result.replayed === 1 ? "" : "s"} to ${result.endpoint_id}`,
    );
    return {
      data: result,
      table: () => {
        console.log();
        console.log(`Endpoint:   ${result.endpoint_id}`);
        console.log(`Replay id:  ${result.replay_id}`);
        console.log(`Window:     ${result.window.from} .. ${result.window.to}`);
        console.log(`Replayed:   ${result.replayed}`);
        console.log();
        console.log(
          chalk.yellow(
            "Envelope ids are unchanged: your consumer's dedup decides what a redelivery means. Mind your downstream billing system's dedup window before replaying old ranges.",
          ),
        );
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "replay spend events" });
    process.exit(1);
  }
};

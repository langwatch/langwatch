import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { VirtualKeysApiService } from "@/client-sdk/services/virtual-keys/virtual-keys-api.service";
import { resolveCredentials } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";

export interface VirtualKeySpendOptions {
  from?: string;
  to?: string;
}

/**
 * Aggregate spend for one key over a window (default: the current UTC
 * calendar month). The server reads the same cost path the dashboard
 * reads, so this number and the UI column agree by construction — the
 * read-back half of the reseller loop (mint a key, cap it, show the
 * customer their spend).
 */
export const virtualKeySpendCommand = async (
  id: string,
  options: VirtualKeySpendOptions,
): Promise<CommandResult | void> => {
  await resolveCredentials();

  const service = new VirtualKeysApiService();
  const spinner = createSpinner(`Reading spend for "${id}"...`).start();

  try {
    const summary = await service.spend(id, {
      from: options.from,
      to: options.to,
    });

    spinner.succeed(`Spend for ${chalk.cyan(id)}`);

    return {
      data: summary,
      table: () => {
        console.log();
        console.log(`${chalk.bold("Virtual key:")} ${summary.virtual_key_id}`);
        console.log(`${chalk.bold("Window:")}      ${new Date(summary.window.from).toLocaleString()} → ${new Date(summary.window.to).toLocaleString()}`);
        console.log(`${chalk.bold("Spent:")}       $${Number.parseFloat(summary.spent_usd).toFixed(4)}`);
        console.log(`${chalk.bold("Requests:")}    ${summary.requests}`);
        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "read virtual key spend" });
    process.exit(1);
  }
};

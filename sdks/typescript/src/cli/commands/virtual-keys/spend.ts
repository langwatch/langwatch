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
 * A `--from` / `--to` flag as the epoch milliseconds the API takes.
 *
 * The flag stays human: a date or timestamp anyone would type, or the epoch
 * value itself. Only the wire is strict about the unit.
 */
function parseWindowBound(flag: string, value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const asEpoch = Number(value);
  const ms = Number.isFinite(asEpoch) ? asEpoch : Date.parse(value);
  if (!Number.isFinite(ms)) {
    throw new Error(`${flag} must be a date or epoch milliseconds, got "${value}"`);
  }
  return Math.trunc(ms);
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
      from: parseWindowBound("--from", options.from),
      to: parseWindowBound("--to", options.to),
    });

    spinner.succeed(`Spend for ${chalk.cyan(id)}`);

    return {
      data: summary,
      table: () => {
        console.log();
        console.log(`${chalk.bold("Virtual key:")} ${summary.virtual_key_id}`);
        console.log(
          `${chalk.bold("Window:")}      ${new Date(summary.window.from).toLocaleString()} → ${new Date(summary.window.to).toLocaleString()}`,
        );
        console.log(
          `${chalk.bold("Spent:")}       $${Number.parseFloat(summary.spent_usd).toFixed(4)}`,
        );
        console.log(`${chalk.bold("Requests:")}    ${summary.requests}`);
        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "read virtual key spend" });
    process.exit(1);
  }
};

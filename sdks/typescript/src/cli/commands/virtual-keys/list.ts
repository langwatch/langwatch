import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { VirtualKeysApiService } from "@/client-sdk/services/virtual-keys/virtual-keys-api.service";
import { resolveCredentials } from "../../utils/apiKey";
import { formatTable } from "../../utils/formatting";
import { failSpinner } from "../../utils/spinnerError";
import { formatScope, formatStatus } from "./_shared";
import type { CommandResult } from "../../utils/output";

/**
 * Returns the listing rather than printing it: the output port renders it in
 * whatever format the caller asked for (utils/output.ts). The list model
 * carries no secrets — only `display_prefix`, exactly what the human table
 * shows — so the raw list is safe to hand to a machine caller.
 */
export const listVirtualKeysCommand = async (): Promise<CommandResult | void> => {
  await resolveCredentials();

  const service = new VirtualKeysApiService();
  const spinner = createSpinner("Fetching virtual keys...").start();

  try {
    const keys = await service.list();

    spinner.succeed(`Found ${keys.length} virtual key${keys.length !== 1 ? "s" : ""}`);

    return {
      data: keys,
      table: () => {
        if (keys.length === 0) {
          console.log();
          console.log(chalk.gray("No virtual keys yet."));
          console.log(chalk.gray("Create one with:"));
          console.log(chalk.cyan('  langwatch virtual-keys create --name "my-key"'));
          return;
        }

        console.log();

        const tableData = keys.map((vk) => ({
          ID: vk.id,
          Name: vk.name,
          Status: formatStatus(vk.status),
          Prefix: `${vk.display_prefix}...`,
          Scopes: vk.scopes.map(formatScope).join(", ") || chalk.gray("—"),
          Routing: vk.routing_mode,
          Purpose: vk.purpose === "langy" ? chalk.magenta("langy") : "user",
          "Last used": vk.last_used_at
            ? new Date(vk.last_used_at).toLocaleDateString()
            : chalk.gray("—"),
        }));

        formatTable({
          data: tableData,
          headers: ["ID", "Name", "Status", "Prefix", "Scopes", "Routing", "Purpose", "Last used"],
          colorMap: {
            Name: chalk.cyan,
            ID: chalk.gray,
          },
        });

        console.log();
        console.log(
          chalk.gray(
            `Use ${chalk.cyan("langwatch virtual-keys get <id>")} to see scopes, routing policy, and config.`,
          ),
        );
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch virtual keys" });
    process.exit(1);
  }
};

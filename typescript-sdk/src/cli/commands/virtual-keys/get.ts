import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { VirtualKeysApiService } from "@/client-sdk/services/virtual-keys/virtual-keys-api.service";
import { resolveCredentials } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import { formatScope, formatStatus, virtualKeyDetailUrl } from "./_shared";
import type { CommandResult } from "../../utils/output";

/**
 * Returns the virtual key rather than printing it: the output port renders it
 * in whatever format the caller asked for (utils/output.ts). The read model
 * carries no secret — only `display_prefix`, exactly what the human view
 * shows — so the raw record is safe to hand to a machine caller.
 */
export const getVirtualKeyCommand = async (
  id: string,
): Promise<CommandResult | void> => {
  await resolveCredentials();

  const service = new VirtualKeysApiService();
  const spinner = createSpinner(`Fetching virtual key "${id}"...`).start();

  try {
    const vk = await service.get(id);

    spinner.succeed(`Fetched virtual key "${chalk.cyan(vk.name)}"`);

    return {
      data: vk,
      table: () => {
        console.log();
        console.log(`${chalk.bold("ID:")}           ${vk.id}`);
        console.log(`${chalk.bold("Name:")}         ${chalk.cyan(vk.name)}`);
        if (vk.description) {
          console.log(`${chalk.bold("Description:")}  ${vk.description}`);
        }
        console.log(`${chalk.bold("Status:")}       ${formatStatus(vk.status)}`);
        console.log(`${chalk.bold("Purpose:")}      ${vk.purpose}`);
        console.log(`${chalk.bold("Prefix:")}       ${vk.display_prefix}...`);
        console.log(`${chalk.bold("Principal:")}    ${vk.principal_user_id ?? chalk.gray("—")}`);
        console.log(`${chalk.bold("Scopes:")}       ${vk.scopes.map(formatScope).join(", ") || chalk.gray("—")}`);
        if (vk.trace_project_id) {
          console.log(`${chalk.bold("Trace proj.:")}  ${vk.trace_project_id}`);
        }
        console.log(`${chalk.bold("Routing mode:")} ${vk.routing_mode}`);
        console.log(`${chalk.bold("Routing pol.:")} ${vk.routing_policy_id ?? chalk.gray("(none)")}`);
        console.log(`${chalk.bold("Created:")}      ${new Date(vk.created_at).toLocaleString()}`);
        if (vk.last_used_at) {
          console.log(`${chalk.bold("Last used:")}    ${new Date(vk.last_used_at).toLocaleString()}`);
        }
        if (vk.revoked_at) {
          console.log(`${chalk.bold("Revoked:")}      ${chalk.red(new Date(vk.revoked_at).toLocaleString())}`);
        }
        const detailUrl = virtualKeyDetailUrl(vk.id);
        if (detailUrl) {
          console.log(`${chalk.bold("View in UI:")}  ${chalk.cyan(detailUrl)}`);
        }
        console.log();
        console.log(chalk.bold("Config:"));
        console.log(JSON.stringify(vk.config, null, 2));
        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch virtual key" });
    process.exit(1);
  }
};

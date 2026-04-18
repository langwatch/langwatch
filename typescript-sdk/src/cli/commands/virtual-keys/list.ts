import chalk from "chalk";
import ora from "ora";
import { VirtualKeysApiService } from "@/client-sdk/services/virtual-keys/virtual-keys-api.service";
import { checkApiKey } from "../../utils/apiKey";
import { formatTable } from "../../utils/formatting";
import { failSpinner } from "../../utils/spinnerError";

export const listVirtualKeysCommand = async (options?: { format?: string }): Promise<void> => {
  checkApiKey();

  const service = new VirtualKeysApiService();
  const spinner = ora("Fetching virtual keys...").start();

  try {
    const keys = await service.list();

    spinner.succeed(`Found ${keys.length} virtual key${keys.length !== 1 ? "s" : ""}`);

    if (options?.format === "json") {
      console.log(JSON.stringify(keys, null, 2));
      return;
    }

    if (keys.length === 0) {
      console.log();
      console.log(chalk.gray("No virtual keys yet."));
      console.log(chalk.gray("Create one with:"));
      console.log(chalk.cyan('  langwatch virtual-keys create --name "my-key" --provider <provider-id>'));
      return;
    }

    console.log();

    const tableData = keys.map((vk) => ({
      ID: vk.id,
      Name: vk.name,
      Env: vk.environment === "live" ? chalk.yellow("live") : chalk.gray("test"),
      Status: vk.status === "ACTIVE" ? chalk.green("active") : chalk.red("revoked"),
      Prefix: `${vk.prefix}...${vk.last_four}`,
      Providers: String(vk.provider_credential_ids.length),
      "Last used": vk.last_used_at ? new Date(vk.last_used_at).toLocaleDateString() : chalk.gray("—"),
    }));

    formatTable({
      data: tableData,
      headers: ["ID", "Name", "Env", "Status", "Prefix", "Providers", "Last used"],
      colorMap: {
        Name: chalk.cyan,
        ID: chalk.gray,
      },
    });

    console.log();
    console.log(
      chalk.gray(
        `Use ${chalk.cyan("langwatch virtual-keys get <id>")} to see config and attached providers.`,
      ),
    );
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch virtual keys" });
    process.exit(1);
  }
};

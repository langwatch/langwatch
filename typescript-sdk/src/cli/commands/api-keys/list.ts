import chalk from "chalk";
import ora from "ora";
import { ApiKeysApiService } from "@/client-sdk/services/api-keys/api-keys-api.service";
import { checkApiKey } from "../../utils/apiKey";
import { formatTable } from "../../utils/formatting";
import { failSpinner } from "../../utils/spinnerError";

export const listApiKeysCommand = async (options?: { format?: string }): Promise<void> => {
  checkApiKey();

  const service = new ApiKeysApiService();
  const spinner = ora("Fetching API keys...").start();

  try {
    const keys = await service.list();

    spinner.succeed(`Found ${keys.length} API key${keys.length !== 1 ? "s" : ""}`);

    if (options?.format === "json") {
      console.log(JSON.stringify(keys, null, 2));
      return;
    }

    if (keys.length === 0) {
      console.log();
      console.log(chalk.gray("No API keys found."));
      console.log(chalk.gray("Create one with:"));
      console.log(chalk.cyan('  langwatch api-keys create --name "my-key"'));
      return;
    }

    console.log();

    const now = Date.now();
    const tableData = keys.map((k) => {
      const isExpired = !!k.expiresAt && new Date(k.expiresAt).getTime() <= now;
      const status = k.revokedAt
        ? chalk.red("revoked")
        : isExpired
          ? chalk.yellow("expired")
          : chalk.green("active");

      return {
        ID: k.id,
        Name: k.name,
        Status: status,
        Bindings: String(k.roleBindings.length),
        Expires: k.expiresAt ? new Date(k.expiresAt).toLocaleDateString() : chalk.gray("never"),
        "Last used": k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleDateString() : chalk.gray("—"),
        Created: new Date(k.createdAt).toLocaleDateString(),
      };
    });

    formatTable({
      data: tableData,
      headers: ["ID", "Name", "Status", "Bindings", "Expires", "Last used", "Created"],
      colorMap: {
        Name: chalk.cyan,
        ID: chalk.gray,
      },
    });

    console.log();
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch API keys" });
    process.exit(1);
  }
};

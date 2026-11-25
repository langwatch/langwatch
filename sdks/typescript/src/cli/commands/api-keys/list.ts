import chalk from "chalk";

import { ApiKeysApiService } from "@/client-sdk/services/api-keys/api-keys-api.service";

import { resolveCredentials } from "../../utils/apiKey";
import { formatTable } from "../../utils/formatting";
import type { CommandResult } from "../../utils/output";
import { createSpinner } from "../../utils/spinner";
import { failSpinner } from "../../utils/spinnerError";

type ApiKey = Awaited<ReturnType<ApiKeysApiService["list"]>>[number];

const formatApiKeyStatus = (key: ApiKey, now: number): string => {
  if (key.revokedAt) return chalk.red("revoked");

  const isExpired = !!key.expiresAt && new Date(key.expiresAt).getTime() <= now;
  if (isExpired) return chalk.yellow("expired");

  return chalk.green("active");
};

/**
 * Returns the listing rather than printing it (output port renders per-format).
 * `ApiKeyInfo` carries no token material -- a token exists only in the create
 * response -- so the raw list is safe for a machine caller.
 */
export const listApiKeysCommand = async (): Promise<CommandResult | void> => {
  await resolveCredentials();

  const service = new ApiKeysApiService();
  const spinner = createSpinner("Fetching API keys...").start();

  try {
    const keys = await service.list();

    spinner.succeed(`Found ${keys.length} API key${keys.length !== 1 ? "s" : ""}`);

    return {
      data: keys,
      table: () => {
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
          return {
            ID: k.id,
            Name: k.name,
            Status: formatApiKeyStatus(k, now),
            Bindings: String(k.roleBindings.length),
            Expires: k.expiresAt ? new Date(k.expiresAt).toLocaleDateString() : chalk.gray("never"),
            "Last used": k.lastUsedAt
              ? new Date(k.lastUsedAt).toLocaleDateString()
              : chalk.gray("—"),
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
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch API keys" });
    process.exit(1);
  }
};

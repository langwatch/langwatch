import chalk from "chalk";
import { ApiKeysApiService } from "@/client-sdk/services/api-keys/api-keys-api.service";
import { formatTable } from "../../utils/formatting";
import type { CommandResult } from "../../utils/output";
import { asDate, orDash, printFacts, runManagement } from "../management/_shared";

/**
 * Read one API key and the access it carries. No token material: a token
 * exists only in the create response, so this is safe to hand to a machine
 * caller as-is.
 */
export const getApiKeyCommand = async (
  id: string,
): Promise<CommandResult | void> =>
  runManagement({
    action: "fetch API key",
    pending: `Fetching API key "${id}"...`,
    run: () => new ApiKeysApiService().get(id),
    succeed: (apiKey) => `API key "${chalk.cyan(apiKey.name)}"`,
    table: (apiKey) => {
      printFacts([
        ["ID", chalk.gray(apiKey.id)],
        ["Name", chalk.cyan(apiKey.name)],
        ["Description", orDash(apiKey.description)],
        ["Type", apiKey.keyType],
        ["Acts as", orDash(apiKey.assignedToUserId)],
        ["Permission mode", apiKey.permissionMode],
        [
          "Permissions",
          apiKey.permissions.length > 0
            ? apiKey.permissions.join(", ")
            : chalk.gray("from the bindings"),
        ],
        [
          "Status",
          apiKey.revokedAt ? chalk.red("revoked") : chalk.green("active"),
        ],
        ["Expires", asDate(apiKey.expiresAt)],
        ["Last used", asDate(apiKey.lastUsedAt)],
      ]);

      if (apiKey.roleBindings.length === 0) {
        console.log(chalk.gray("  No bindings: this key has organization-wide access."));
        console.log();
        return;
      }
      formatTable({
        data: apiKey.roleBindings.map((binding) => ({
          "Binding ID": binding.id,
          Role: binding.role,
          Scope: `${binding.scopeType} ${binding.scopeId}`,
        })),
        headers: ["Binding ID", "Role", "Scope"],
        colorMap: { "Binding ID": chalk.gray, Role: chalk.cyan },
      });
      console.log();
    },
  });

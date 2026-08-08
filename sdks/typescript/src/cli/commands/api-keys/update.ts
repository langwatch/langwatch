import chalk from "chalk";
import {
  ApiKeysApiService,
  type UpdateApiKeyInput,
} from "@/client-sdk/services/api-keys/api-keys-api.service";
import {
  commandValidationError,
  reportCommandError,
} from "../../utils/errorOutput";
import { formatTable } from "../../utils/formatting";
import {
  parseBindingFlags,
  parsePermissionFlags,
  parsePermissionMode,
} from "../../utils/managementFlags";
import type { CommandResult } from "../../utils/output";
import { orDash, printFacts, runManagement, withParsedFlags } from "../management/_shared";

export interface UpdateApiKeyOptions {
  name?: string;
  description?: string;
  binding?: string[];
  permission?: string[];
  permissionMode?: string;
}

/**
 * Update an API key's name, description and the access it carries. The access
 * is the reason this command exists.
 *
 * `--binding` REPLACES the key's bindings with exactly the ones given: a key's
 * reach is the set of bindings it holds, and a flag that only added would make
 * "tighten this key" impossible to express.
 */
export const updateApiKeyCommand = async ({
  id,
  options,
}: {
  id: string;
  options: UpdateApiKeyOptions;
}): Promise<CommandResult | void> => {
  const input = withParsedFlags((): UpdateApiKeyInput => {
    const bindings = parseBindingFlags(options.binding);
    const permissions = parsePermissionFlags(options.permission);
    // Keyed on the flag being GIVEN, not on what it parsed to: replacing a
    // key's reach with a smaller set is the reason these flags exist.
    return {
      ...(options.name !== undefined ? { name: options.name } : {}),
      ...(options.description !== undefined
        ? { description: options.description }
        : {}),
      ...(options.permissionMode !== undefined
        ? { permissionMode: parsePermissionMode(options.permissionMode) }
        : {}),
      ...(options.permission !== undefined ? { permissions } : {}),
      ...(options.binding !== undefined
        ? {
            bindings: bindings.map((binding) => ({
              role: binding.role,
              scopeType: binding.scopeType,
              scopeId: binding.scopeId,
            })),
          }
        : {}),
    };
  });

  if (Object.keys(input).length === 0) {
    reportCommandError({
      error: commandValidationError(
        "Nothing to update. Pass at least one of --name, --description, --binding, --permission or --permission-mode.",
      ),
    });
    process.exit(1);
  }

  return runManagement({
    action: "update API key",
    pending: `Updating API key "${id}"...`,
    run: () => new ApiKeysApiService().update({ id, input }),
    succeed: (apiKey) => `Updated API key "${chalk.cyan(apiKey.name)}"`,
    table: (apiKey) => {
      printFacts([
        ["ID", chalk.gray(apiKey.id)],
        ["Name", chalk.cyan(apiKey.name)],
        ["Description", orDash(apiKey.description)],
        ["Permission mode", apiKey.permissionMode],
        [
          "Permissions",
          apiKey.permissions.length > 0
            ? apiKey.permissions.join(", ")
            : chalk.gray("from the bindings"),
        ],
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
};

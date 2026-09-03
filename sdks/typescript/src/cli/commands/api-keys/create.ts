import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { ApiKeysApiService } from "@/client-sdk/services/api-keys/api-keys-api.service";
import { resolveCredentials } from "../../utils/apiKey";
import {
  parseBindingFlags,
  parsePermissionFlags,
  parsePermissionMode,
} from "../../utils/managementFlags";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";
import { withParsedFlags } from "../management/_shared";

export interface CreateApiKeyOptions {
  name: string;
  keyType?: "personal" | "service";
  description?: string;
  expiresAt?: string;
  projectId?: string[];
  /** Repeatable `role:scopeType:scopeId`: precisely what the key may reach. */
  binding?: string[];
  /** Repeatable `resource:action`, for a restricted key. */
  permission?: string[];
  permissionMode?: string;
  /** Organization admins only: the member the key acts as. */
  assignedToUserId?: string;
}

/**
 * Returns the created key rather than printing it: the output port renders it
 * in whatever format the caller asked for (utils/output.ts).
 *
 * `data` deliberately includes `result.token`. This is the ONE moment the token
 * exists (the server never returns it again) and the human output prints it
 * in full for exactly that reason, as did the previous `--format json` branch.
 * Withholding it from the machine payload would make `api-key create -o json`
 * useless for the scripted case it exists to serve.
 */
export const createApiKeyCommand = async (
  options: CreateApiKeyOptions,
): Promise<CommandResult | void> => {
  await resolveCredentials();

  if (!options.name) {
    console.error(chalk.red("Error: --name is required"));
    process.exit(1);
  }

  const access = withParsedFlags(() => ({
    bindings: parseBindingFlags(options.binding).map((binding) => ({
      role: binding.role,
      scopeType: binding.scopeType,
      scopeId: binding.scopeId,
    })),
    permissions: parsePermissionFlags(options.permission),
    ...(options.permissionMode !== undefined
      ? { permissionMode: parsePermissionMode(options.permissionMode) }
      : {}),
  }));

  const service = new ApiKeysApiService();
  const keyType = options.keyType ?? "service";
  const spinner = createSpinner(`Creating ${keyType} API key "${options.name}"...`).start();

  try {
    const result = await service.create({
      keyType,
      name: options.name,
      description: options.description,
      expiresAt: options.expiresAt,
      projectIds: options.projectId,
      ...(options.assignedToUserId !== undefined
        ? { assignedToUserId: options.assignedToUserId }
        : {}),
      ...(access.permissionMode !== undefined ? { permissionMode: access.permissionMode } : {}),
      ...(access.permissions.length > 0 ? { permissions: access.permissions } : {}),
      ...(access.bindings.length > 0 ? { bindings: access.bindings } : {}),
    });

    spinner.succeed(`Created ${keyType} API key "${chalk.cyan(result.apiKey.name)}"`);

    return {
      data: result,
      table: () => {
        console.log();
        console.log(chalk.bold.yellow("⚠  Save the token below NOW. It will not be shown again."));
        console.log();
        console.log(`  ${chalk.green(result.token)}`);
        console.log();
        console.log(chalk.gray("API key id: ") + result.apiKey.id);
        console.log(
          chalk.gray("Created:    ") + new Date(result.apiKey.createdAt).toLocaleString(),
        );
        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "create API key" });
    process.exit(1);
  }
};

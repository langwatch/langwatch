import chalk from "chalk";
import { RolesApiService } from "@/client-sdk/services/roles/roles-api.service";
import {
  commandValidationError,
  reportCommandError,
} from "../../utils/errorOutput";
import { parsePermissionFlags } from "../../utils/managementFlags";
import type { CommandResult } from "../../utils/output";
import { orDash, printFacts, runManagement, withParsedFlags } from "../management/_shared";

export interface CreateRoleOptions {
  name: string;
  description?: string;
  permission?: string[];
}

/**
 * Create a custom role from repeated `--permission resource:action` flags.
 * The name is the natural key: a taken one answers 409 rather than creating a
 * second role that means the same thing.
 */
export const createRoleCommand = async (
  options: CreateRoleOptions,
): Promise<CommandResult | void> => {
  const permissions = withParsedFlags(() =>
    parsePermissionFlags(options.permission),
  );

  if (permissions.length === 0) {
    reportCommandError({
      error: commandValidationError(
        "A custom role needs at least one permission. Pass --permission resource:action (repeatable); list the catalog with `langwatch roles permissions`.",
      ),
    });
    process.exit(1);
  }

  return runManagement({
    action: "create custom role",
    pending: `Creating custom role "${options.name}"...`,
    run: () =>
      new RolesApiService().create({
        name: options.name,
        ...(options.description !== undefined
          ? { description: options.description }
          : {}),
        permissions,
      }),
    succeed: (role) => `Created custom role "${chalk.cyan(role.name)}"`,
    table: (role) => {
      printFacts([
        ["ID", chalk.gray(role.id)],
        ["Name", chalk.cyan(role.name)],
        ["Description", orDash(role.description)],
        ["Permissions", role.permissions.join(", ")],
      ]);
    },
  });
};

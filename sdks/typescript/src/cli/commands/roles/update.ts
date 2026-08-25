import chalk from "chalk";
import {
  RolesApiService,
  type UpdateRoleInput,
} from "@/client-sdk/services/roles/roles-api.service";
import { commandValidationError, reportCommandError } from "../../utils/errorOutput";
import { parsePermissionFlags } from "../../utils/managementFlags";
import type { CommandResult } from "../../utils/output";
import {
  orDash,
  printFacts,
  runManagement,
  withParsedFlags,
} from "../management/_shared";

export interface UpdateRoleOptions {
  name?: string;
  description?: string;
  permission?: string[];
}

/**
 * Update a custom role. Partial, except for the permissions: a `--permission`
 * list REPLACES the set outright, because a role is defined by exactly what it
 * grants and adding to it silently would leave nobody able to say what the
 * role means.
 */
export const updateRoleCommand = async ({
  id,
  options,
}: {
  id: string;
  options: UpdateRoleOptions;
}): Promise<CommandResult | void> => {
  const permissions = withParsedFlags(() => parsePermissionFlags(options.permission));

  // Keyed on the flag being GIVEN, not on what it parsed to: a caller who
  // asked to replace the set is asking for exactly the set they named.
  const input: UpdateRoleInput = {
    ...(options.name !== undefined ? { name: options.name } : {}),
    ...(options.description !== undefined ? { description: options.description } : {}),
    ...(options.permission !== undefined ? { permissions } : {}),
  };

  if (Object.keys(input).length === 0) {
    reportCommandError({
      error: commandValidationError(
        "Nothing to update. Pass at least one of --name, --description or --permission.",
      ),
    });
    process.exit(1);
  }

  return runManagement({
    action: "update custom role",
    pending: `Updating custom role "${id}"...`,
    run: () => new RolesApiService().update({ id, input }),
    succeed: (role) => `Updated custom role "${chalk.cyan(role.name)}"`,
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

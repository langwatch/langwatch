/**
 * Key access rendering shared between get and update. Never overstates reach:
 * empty binding lists must display empty, not permission mode values.
 */
import chalk from "chalk";

import type { ApiKeyDetail } from "@/client-sdk/services/api-keys/api-keys-api.service";

import { formatTable } from "../../utils/formatting";

/**
 * Where the key's permissions come from: the explicit list a restricted key
 * carries, the roles its bindings grant, or nothing at all.
 */
export const permissionsCell = (apiKey: ApiKeyDetail): string => {
  if (apiKey.permissions.length > 0) return apiKey.permissions.join(", ");
  if (apiKey.roleBindings.length > 0) return chalk.gray("from the bindings");
  return chalk.gray("none");
};

/** The bindings a key holds, or what it means to hold none. */
export const printBindings = (apiKey: ApiKeyDetail): void => {
  if (apiKey.roleBindings.length === 0) {
    console.log(chalk.gray("  No bindings: this key grants no access anywhere."));
    console.log(
      chalk.cyan(`  langwatch api-keys update ${apiKey.id} --binding role:scopeType:scopeId`),
    );
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
};

/**
 * How a key's access is rendered, shared by `api-keys get` and `api-keys update`
 * so a read after a write describes the key the same way the write just did.
 *
 * The one thing this rendering must never do is overstate a key's reach. A key's
 * own role bindings are a hard gate at resolution time: the platform intersects
 * them with the owning member's, so a key holding none resolves to no permission
 * at any scope. `permissionMode` carries no authority of its own, it is the
 * authoring shape the bindings were written from, so it cannot widen an empty
 * set. An operator who has just tightened a key reads this output to check their
 * work, and "organization-wide" printed over an empty binding list would tell
 * them the tightening did not take.
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
      chalk.cyan(
        `  langwatch api-keys update ${apiKey.id} --binding role:scopeType:scopeId`,
      ),
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

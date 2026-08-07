import chalk from "chalk";
import type { MemberAccessBinding } from "@/client-sdk/services/organization/organization-api.service";
import { OrganizationApiService } from "@/client-sdk/services/organization/organization-api.service";
import { formatTable } from "../../utils/formatting";
import type { CommandResult } from "../../utils/output";
import { orDash, runManagement } from "../management/_shared";

const bindingRows = (bindings: MemberAccessBinding[], source: string) =>
  bindings.map((binding) => ({
    Source: source,
    Role: binding.customRoleName ?? binding.role,
    Scope: `${binding.scopeType} ${binding.scopeName ?? binding.scopeId}`,
    Permissions: String(binding.permissions.length),
  }));

/**
 * The member's full access breakdown: the organization role they hold, the
 * groups they belong to with the bindings each group carries, and the bindings
 * granted to them directly.
 */
export const memberAccessCommand = async (
  userId: string,
): Promise<CommandResult | void> =>
  runManagement({
    action: "fetch member access",
    pending: `Fetching access for member "${userId}"...`,
    run: () => new OrganizationApiService().getMemberAccess(userId),
    succeed: (access) =>
      `Access for "${chalk.cyan(access.user.name ?? access.user.email ?? userId)}"`,
    table: (access) => {
      console.log();
      console.log(
        `  ${chalk.gray("Organization role:")} ${chalk.cyan(access.user.orgRole)} ` +
          chalk.gray(`(${access.user.orgRolePermissions.length} permissions)`),
      );
      console.log();

      const rows = [
        ...access.directBindings.flatMap((binding) =>
          bindingRows([binding], "direct"),
        ),
        ...access.groups.flatMap((group) =>
          bindingRows(group.bindings, `group ${group.name}`),
        ),
      ];

      if (rows.length === 0) {
        console.log(
          chalk.gray("  No group or direct bindings beyond the organization role."),
        );
        console.log();
        return;
      }

      formatTable({
        data: rows,
        headers: ["Source", "Role", "Scope", "Permissions"],
        colorMap: { Source: chalk.gray, Role: chalk.cyan },
      });
      console.log();
      console.log(
        chalk.gray(
          `  Groups: ${access.groups.length > 0 ? access.groups.map((group) => group.name).join(", ") : orDash(null)}`,
        ),
      );
      console.log();
    },
  });

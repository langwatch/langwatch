import chalk from "chalk";
import { GroupsApiService } from "@/client-sdk/services/groups/groups-api.service";
import { formatTable } from "../../utils/formatting";
import { parseRole, parseScopeType } from "../../utils/managementFlags";
import type { CommandResult } from "../../utils/output";
import {
  counted,
  orDash,
  printEmpty,
  printFacts,
  runManagement,
  withParsedFlags,
} from "../management/_shared";

export interface AddGroupBindingOptions {
  role: string;
  customRoleId?: string;
  scopeType: string;
  scopeId: string;
}

export const listGroupBindingsCommand = async (
  groupId: string,
): Promise<CommandResult | void> =>
  runManagement({
    action: "list group bindings",
    pending: `Fetching bindings of group "${groupId}"...`,
    run: () => new GroupsApiService().listBindings(groupId),
    succeed: (result) =>
      `Found ${counted({ count: result.data.length, singular: "binding", plural: "bindings" })}`,
    table: (result) => {
      if (result.data.length === 0) {
        printEmpty({ what: "group bindings" });
        return;
      }
      console.log();
      formatTable({
        data: result.data.map((binding) => ({
          ID: binding.id,
          Role: binding.role,
          "Custom role": orDash(binding.customRoleName),
          Scope: `${binding.scopeType} ${binding.scopeId}`,
        })),
        headers: ["ID", "Role", "Custom role", "Scope"],
        colorMap: { ID: chalk.gray, Role: chalk.cyan },
      });
      console.log();
    },
  });

/**
 * Grant the whole group a role at a scope. Everything the group's members are
 * allowed to do beyond their own bindings comes from here.
 */
export const addGroupBindingCommand = async ({
  groupId,
  options,
}: {
  groupId: string;
  options: AddGroupBindingOptions;
}): Promise<CommandResult | void> => {
  const input = withParsedFlags(() => ({
    role: parseRole(options.role),
    ...(options.customRoleId !== undefined
      ? { customRoleId: options.customRoleId }
      : {}),
    scopeType: parseScopeType(options.scopeType),
    scopeId: options.scopeId,
  }));

  return runManagement({
    action: "add group binding",
    pending: `Adding a binding to group "${groupId}"...`,
    run: () => new GroupsApiService().addBinding({ groupId, input }),
    succeed: (binding) =>
      `Bound ${chalk.cyan(binding.role)} at ${binding.scopeType} "${binding.scopeId}"`,
    table: (binding) => {
      printFacts([
        ["ID", chalk.gray(binding.id)],
        ["Role", chalk.cyan(binding.role)],
        ["Scope", `${binding.scopeType} ${binding.scopeId}`],
      ]);
    },
  });
};

export const removeGroupBindingCommand = async ({
  groupId,
  bindingId,
}: {
  groupId: string;
  bindingId: string;
}): Promise<CommandResult | void> =>
  runManagement({
    action: "remove group binding",
    pending: `Removing binding "${bindingId}" from group "${groupId}"...`,
    run: () => new GroupsApiService().removeBinding({ groupId, bindingId }),
    succeed: () => `Removed binding "${bindingId}" from group "${groupId}"`,
    table: () => {
      console.log();
      console.log(
        chalk.gray("The group no longer grants that role at that scope."),
      );
      console.log();
    },
  });

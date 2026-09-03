import chalk from "chalk";
import {
  RoleBindingsApiService,
  type UpdateRoleBindingInput,
} from "@/client-sdk/services/role-bindings/role-bindings-api.service";
import { parseRole } from "../../utils/managementFlags";
import type { CommandResult } from "../../utils/output";
import {
  orDash,
  printFacts,
  runManagement,
  withParsedFlags,
} from "../management/_shared";

export interface UpdateRoleBindingOptions {
  role: string;
  customRoleId?: string;
}

/**
 * Change the role an existing binding grants. The principal and the scope are
 * the binding's identity and cannot change; regrant with create and delete
 * instead.
 */
export const updateRoleBindingCommand = async ({
  id,
  options,
}: {
  id: string;
  options: UpdateRoleBindingOptions;
}): Promise<CommandResult | void> => {
  const input = withParsedFlags((): UpdateRoleBindingInput => ({
    role: parseRole(options.role),
    ...(options.customRoleId !== undefined ? { customRoleId: options.customRoleId } : {}),
  }));

  return runManagement({
    action: "update role binding",
    pending: `Updating role binding "${id}"...`,
    run: () => new RoleBindingsApiService().update({ id, input }),
    succeed: (binding) =>
      `Now grants ${chalk.cyan(binding.customRoleName ?? binding.role)} to ${binding.principal.type} "${binding.principal.name ?? binding.principal.id}"`,
    table: (binding) => {
      printFacts([
        ["ID", chalk.gray(binding.id)],
        [
          "Principal",
          `${binding.principal.type} ${chalk.cyan(binding.principal.name ?? binding.principal.id)}`,
        ],
        ["Role", binding.role],
        ["Custom role", orDash(binding.customRoleName)],
        ["Scope", `${binding.scopeType} ${binding.scopeName ?? binding.scopeId}`],
      ]);
    },
  });
};

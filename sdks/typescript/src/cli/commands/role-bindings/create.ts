import chalk from "chalk";
import {
  RoleBindingsApiService,
  type CreateRoleBindingInput,
} from "@/client-sdk/services/role-bindings/role-bindings-api.service";
import {
  composeRoleBindingPrincipal,
  parseRole,
  parseScopeType,
} from "../../utils/managementFlags";
import type { CommandResult } from "../../utils/output";
import { orDash, printFacts, runManagement, withParsedFlags } from "../management/_shared";

export interface CreateRoleBindingOptions {
  principalType: string;
  principalId: string;
  role: string;
  customRoleId?: string;
  scopeType: string;
  scopeId: string;
}

/**
 * Grant one role to one principal at one scope. An identical binding answers
 * 409 `role_binding_already_exists`, which a provisioning tool reads as
 * "already done".
 */
export const createRoleBindingCommand = async (
  options: CreateRoleBindingOptions,
): Promise<CommandResult | void> => {
  const input = withParsedFlags((): CreateRoleBindingInput => ({
    ...composeRoleBindingPrincipal({
      principalType: options.principalType,
      principalId: options.principalId,
    }),
    role: parseRole(options.role),
    ...(options.customRoleId !== undefined ? { customRoleId: options.customRoleId } : {}),
    scopeType: parseScopeType(options.scopeType),
    scopeId: options.scopeId,
  }));

  return runManagement({
    action: "create role binding",
    pending: "Creating role binding...",
    run: () => new RoleBindingsApiService().create(input),
    succeed: (binding) =>
      `Bound ${chalk.cyan(binding.customRoleName ?? binding.role)} to ${binding.principal.type} "${binding.principal.name ?? binding.principal.id}"`,
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
      if (binding.hasLegacyAccessNotice) {
        console.log(
          chalk.yellow(
            "  This is the user's first explicit binding. Access they had through team membership alone no longer applies.",
          ),
        );
        console.log();
      }
    },
  });
};

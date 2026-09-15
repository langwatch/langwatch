import chalk from "chalk";
import { RoleBindingsApiService } from "@/client-sdk/services/role-bindings/role-bindings-api.service";
import { formatTable } from "../../utils/formatting";
import {
  composeRoleBindingFilters,
  type RoleBindingFilterFlags,
} from "../../utils/managementFlags";
import type { CommandResult } from "../../utils/output";
import { asDate, counted, printEmpty, runManagement, withParsedFlags } from "../management/_shared";

/**
 * List role bindings, optionally narrowed by principal and scope.
 *
 * Filters are passed through unchanged, and a filter the caller did not give
 * is absent from the request rather than sent empty: an empty filter matches
 * nothing, which would turn "everything" into "nothing".
 */
export const listRoleBindingsCommand = async (
  options: RoleBindingFilterFlags = {},
): Promise<CommandResult | void> => {
  const filters = withParsedFlags(() => composeRoleBindingFilters(options));

  return runManagement({
    action: "list role bindings",
    pending: "Fetching role bindings...",
    run: () => new RoleBindingsApiService().list(filters),
    succeed: (result) =>
      `Found ${counted({ count: result.totalCount, singular: "role binding", plural: "role bindings" })}`,
    table: (result) => {
      if (result.bindings.length === 0) {
        printEmpty({ what: "role bindings" });
        return;
      }
      console.log();
      formatTable({
        data: result.bindings.map((binding) => ({
          ID: binding.id,
          Principal: `${binding.principal.type} ${binding.principal.name ?? binding.principal.id}`,
          Role: binding.customRoleName ?? binding.role,
          Scope: `${binding.scopeType} ${binding.scopeName ?? binding.scopeId}`,
          Created: asDate(binding.createdAt),
        })),
        headers: ["ID", "Principal", "Role", "Scope", "Created"],
        colorMap: { ID: chalk.gray, Principal: chalk.cyan },
      });
      console.log();
    },
  });
};

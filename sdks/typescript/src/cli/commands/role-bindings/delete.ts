import chalk from "chalk";
import { RoleBindingsApiService } from "@/client-sdk/services/role-bindings/role-bindings-api.service";
import type { CommandResult } from "../../utils/output";
import { runManagement } from "../management/_shared";

export const deleteRoleBindingCommand = async (
  id: string,
): Promise<CommandResult | void> =>
  runManagement({
    action: "delete role binding",
    pending: `Deleting role binding "${id}"...`,
    run: () => new RoleBindingsApiService().delete(id),
    succeed: () => `Deleted role binding "${id}"`,
    table: () => {
      console.log();
      console.log(chalk.gray("The principal no longer holds that role at that scope."));
      console.log();
    },
  });

import chalk from "chalk";
import { RolesApiService } from "@/client-sdk/services/roles/roles-api.service";
import type { CommandResult } from "../../utils/output";
import { runManagement } from "../management/_shared";

/**
 * Delete a custom role. A role anything still holds answers 409
 * `custom_role_in_use` with the counts, so nothing loses access silently.
 */
export const deleteRoleCommand = async (
  id: string,
): Promise<CommandResult | void> =>
  runManagement({
    action: "delete custom role",
    pending: `Deleting custom role "${id}"...`,
    run: async () => ({ id, ...(await new RolesApiService().delete(id)) }),
    succeed: () => `Deleted custom role "${id}"`,
    table: () => {
      console.log();
      console.log(chalk.gray("The role no longer exists and grants nothing."));
      console.log();
    },
  });

import chalk from "chalk";
import { RolesApiService } from "@/client-sdk/services/roles/roles-api.service";
import type { CommandResult } from "../../utils/output";
import { asDate, orDash, printFacts, runManagement } from "../management/_shared";

export const getRoleCommand = async (
  id: string,
): Promise<CommandResult | void> =>
  runManagement({
    action: "fetch custom role",
    pending: `Fetching custom role "${id}"...`,
    run: () => new RolesApiService().get(id),
    succeed: (role) => `Custom role "${chalk.cyan(role.name)}"`,
    table: (role) => {
      printFacts([
        ["ID", chalk.gray(role.id)],
        ["Name", chalk.cyan(role.name)],
        ["Description", orDash(role.description)],
        ["Permissions", role.permissions.join(", ")],
        ["Created", asDate(role.createdAt)],
      ]);
    },
  });

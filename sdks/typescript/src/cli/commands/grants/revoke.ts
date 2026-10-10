import chalk from "chalk";

import { GrantsApiService } from "@/client-sdk/services/grants/grants-api.service";

import type { CommandResult } from "../../utils/output";
import { runManagement } from "../management/_shared";

export const revokeGrantCommand = async (id: string): Promise<CommandResult | void> =>
  runManagement({
    action: "revoke grant",
    pending: `Revoking grant "${id}"...`,
    run: () => new GrantsApiService().revoke(id),
    succeed: () => `Revoked grant "${id}"`,
    table: () => {
      console.log();
      console.log(chalk.gray("The principal no longer holds that role at that scope."));
      console.log();
    },
  });

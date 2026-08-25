import chalk from "chalk";
import { OrganizationApiService } from "@/client-sdk/services/organization/organization-api.service";
import type { CommandResult } from "../../utils/output";
import { runManagement } from "../management/_shared";

/** Revoke a pending invite. */
export const revokeInviteCommand = async (id: string): Promise<CommandResult | void> =>
  runManagement({
    action: "revoke invite",
    pending: `Revoking invite "${id}"...`,
    run: () => new OrganizationApiService().revokeInvite(id),
    succeed: () => `Revoked invite "${id}"`,
    table: () => {
      console.log();
      console.log(chalk.gray("The invite link no longer works."));
      console.log();
    },
  });

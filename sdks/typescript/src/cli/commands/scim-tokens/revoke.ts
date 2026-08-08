import chalk from "chalk";
import { ScimTokensApiService } from "@/client-sdk/services/scim-tokens/scim-tokens-api.service";
import type { CommandResult } from "../../utils/output";
import { runManagement } from "../management/_shared";

export const revokeScimTokenCommand = async (
  id: string,
): Promise<CommandResult | void> =>
  runManagement({
    action: "revoke SCIM token",
    pending: `Revoking SCIM token "${id}"...`,
    run: async () => ({ id, ...(await new ScimTokensApiService().revoke(id)) }),
    succeed: () => `Revoked SCIM token "${id}"`,
    table: () => {
      console.log();
      console.log(
        chalk.gray("The identity provider using this token will stop syncing."),
      );
      console.log();
    },
  });

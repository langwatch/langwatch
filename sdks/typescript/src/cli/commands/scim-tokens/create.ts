import chalk from "chalk";

import { ScimTokensApiService } from "@/client-sdk/services/scim-tokens/scim-tokens-api.service";

import type { CommandResult } from "../../utils/output";
import { runManagement } from "../management/_shared";

/**
 * Mints a SCIM bearer token. `data` deliberately includes it -- this is the
 * ONE moment it exists, the platform never returns it again, and a
 * provisioning script reading `-o json` needs it (same as `api-keys create`).
 */
export const createScimTokenCommand = async (
  options: { description?: string } = {},
): Promise<CommandResult | void> =>
  runManagement({
    action: "create SCIM token",
    pending: "Creating SCIM token...",
    run: () =>
      new ScimTokensApiService().create(
        options.description !== undefined ? { description: options.description } : {},
      ),
    succeed: () => "Created SCIM token",
    table: (token) => {
      console.log();
      console.log(chalk.bold.yellow("⚠  Save the token below NOW. It will not be shown again."));
      console.log();
      console.log(`  ${chalk.green(token.token)}`);
      console.log();
      console.log(chalk.gray("Token id:    ") + token.id);
      console.log(chalk.gray("Description: ") + (token.description ?? "—"));
      console.log();
      console.log(
        chalk.gray("Give this to your identity provider as the bearer token for /api/scim/v2."),
      );
      console.log();
    },
  });

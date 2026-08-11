import chalk from "chalk";
import { ScimTokensApiService } from "@/client-sdk/services/scim-tokens/scim-tokens-api.service";
import type { CommandResult } from "../../utils/output";
import { runManagement } from "../management/_shared";

/**
 * Mint a SCIM bearer token for the identity provider.
 *
 * `data` deliberately includes the token: this is the ONE moment it exists,
 * the platform never returns it again, and a provisioning script reading
 * `-o json` needs it. The human rendering says so in as many words, the same
 * warning `api-keys create` prints for the same reason.
 */
export const createScimTokenCommand = async (
  options: { description?: string } = {},
): Promise<CommandResult | void> =>
  runManagement({
    action: "create SCIM token",
    pending: "Creating SCIM token...",
    run: () =>
      new ScimTokensApiService().create(
        options.description !== undefined
          ? { description: options.description }
          : {},
      ),
    succeed: () => "Created SCIM token",
    table: (token) => {
      console.log();
      console.log(
        chalk.bold.yellow(
          "⚠  Save the token below NOW. It will not be shown again.",
        ),
      );
      console.log();
      console.log(`  ${chalk.green(token.token)}`);
      console.log();
      console.log(chalk.gray("Token id:    ") + token.id);
      console.log(chalk.gray("Description: ") + (token.description ?? "—"));
      console.log();
      console.log(
        chalk.gray(
          "Give this to your identity provider as the bearer token for /api/scim/v2.",
        ),
      );
      console.log();
    },
  });

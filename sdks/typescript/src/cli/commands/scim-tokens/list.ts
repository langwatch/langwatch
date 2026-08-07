import chalk from "chalk";
import { ScimTokensApiService } from "@/client-sdk/services/scim-tokens/scim-tokens-api.service";
import { formatTable } from "../../utils/formatting";
import type { CommandResult } from "../../utils/output";
import {
  asDate,
  counted,
  orDash,
  printEmpty,
  runManagement,
} from "../management/_shared";

/**
 * List the organization's SCIM bearer tokens. Token values and hashes are
 * never returned: a value exists only in the create response, once.
 */
export const listScimTokensCommand = async (): Promise<CommandResult | void> =>
  runManagement({
    action: "list SCIM tokens",
    pending: "Fetching SCIM tokens...",
    run: () => new ScimTokensApiService().list(),
    succeed: (result) =>
      `Found ${counted(result.tokens.length, "SCIM token", "SCIM tokens")}`,
    table: (result) => {
      if (result.tokens.length === 0) {
        printEmpty({
          what: "SCIM tokens",
          hint: 'langwatch scim-tokens create --description "Okta"',
        });
        return;
      }
      console.log();
      formatTable({
        data: result.tokens.map((token) => ({
          ID: token.id,
          Description: orDash(token.description),
          Created: asDate(token.createdAt),
          "Last used": asDate(token.lastUsedAt),
        })),
        headers: ["ID", "Description", "Created", "Last used"],
        colorMap: { ID: chalk.gray, Description: chalk.cyan },
      });
      console.log();
    },
  });

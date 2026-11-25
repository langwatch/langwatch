import chalk from "chalk";

import { GrantsApiService } from "@/client-sdk/services/grants/grants-api.service";

import { formatTable } from "../../utils/formatting";
import { composeGrantFilters, type GrantFilterFlags } from "../../utils/managementFlags";
import type { CommandResult } from "../../utils/output";
import { asDate, counted, printEmpty, runManagement, withParsedFlags } from "../management/_shared";
import { principalOf, roleOf, scopeOf } from "./_shared";

/** One page of grants; `--cursor` with the printed next cursor reads the next. */
export const listGrantsCommand = async (
  options: GrantFilterFlags = {},
): Promise<CommandResult | void> => {
  const filters = withParsedFlags(() => composeGrantFilters(options));

  return runManagement({
    action: "list grants",
    pending: "Fetching grants...",
    run: () => new GrantsApiService().list(filters),
    succeed: (page) =>
      `Found ${counted({ count: page.grants.length, singular: "grant", plural: "grants" })}${page.nextCursor ? " on this page" : ""}`,
    table: (page) => {
      if (page.grants.length === 0) {
        printEmpty({ what: "grants" });
        return;
      }
      console.log();
      formatTable({
        data: page.grants.map((grant) => ({
          ID: grant.id,
          Principal: principalOf(grant),
          Role: roleOf(grant),
          Scope: scopeOf(grant),
          Status: grant.status,
          Created: asDate(grant.createdAt),
        })),
        headers: ["ID", "Principal", "Role", "Scope", "Status", "Created"],
        colorMap: { ID: chalk.gray, Principal: chalk.cyan },
      });
      console.log();
      if (page.nextCursor) {
        console.log(chalk.gray(`  Next page: --cursor ${page.nextCursor}`));
        console.log();
      }
    },
  });
};

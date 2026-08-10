import chalk from "chalk";
import { GroupsApiService } from "@/client-sdk/services/groups/groups-api.service";
import { formatTable } from "../../utils/formatting";
import { parseCount } from "../../utils/managementFlags";
import type { CommandResult } from "../../utils/output";
import {
  counted,
  orDash,
  printEmpty,
  runManagement,
  withParsedFlags,
} from "../management/_shared";

export const listGroupsCommand = async (
  options: { page?: string; limit?: string } = {},
): Promise<CommandResult | void> => {
  const query = withParsedFlags(() => ({
    ...(options.page !== undefined
      ? { page: parseCount({ value: options.page, flag: "--page" }) }
      : {}),
    ...(options.limit !== undefined
      ? { limit: parseCount({ value: options.limit, flag: "--limit" }) }
      : {}),
  }));

  return runManagement({
    action: "list groups",
    pending: "Fetching groups...",
    run: () => new GroupsApiService().list(query),
    succeed: (result) =>
      `Found ${counted({ count: result.pagination.total, singular: "group", plural: "groups" })}`,
    table: (result) => {
      if (result.data.length === 0) {
        printEmpty({
          what: "groups",
          hint: 'langwatch groups create --name "Data science"',
        });
        return;
      }
      console.log();
      formatTable({
        data: result.data.map((group) => ({
          ID: group.id,
          Name: group.name,
          Members: String(group.memberCount),
          Bindings: String(group.bindings.length),
          "Managed by": orDash(group.scimSource),
        })),
        headers: ["ID", "Name", "Members", "Bindings", "Managed by"],
        colorMap: { ID: chalk.gray, Name: chalk.cyan },
      });
      console.log();
    },
  });
};

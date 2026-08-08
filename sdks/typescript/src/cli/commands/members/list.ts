import chalk from "chalk";
import { OrganizationApiService } from "@/client-sdk/services/organization/organization-api.service";
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

export interface ListMembersOptions {
  includeDisabled?: boolean;
  offset?: string;
  limit?: string;
}

export const listMembersCommand = async (
  options: ListMembersOptions = {},
): Promise<CommandResult | void> => {
  const query = withParsedFlags(() => ({
    ...(options.includeDisabled ? { includeDisabled: true } : {}),
    ...(options.offset !== undefined
      ? { offset: parseCount(options.offset, "--offset") }
      : {}),
    ...(options.limit !== undefined
      ? { limit: parseCount(options.limit, "--limit") }
      : {}),
  }));

  return runManagement({
    action: "list organization members",
    pending: "Fetching organization members...",
    run: () => new OrganizationApiService().listMembers(query),
    succeed: (result) =>
      `Found ${counted({ count: result.totalCount, singular: "member", plural: "members" })}`,
    table: (result) => {
      if (result.members.length === 0) {
        printEmpty({ what: "members" });
        return;
      }
      console.log();
      formatTable({
        data: result.members.map((member) => ({
          "User ID": member.userId,
          Name: orDash(member.user.name),
          Email: orDash(member.user.email),
          Role: member.role,
          Status: member.disabled ? chalk.yellow("disabled") : chalk.green("active"),
        })),
        headers: ["User ID", "Name", "Email", "Role", "Status"],
        colorMap: { "User ID": chalk.gray, Name: chalk.cyan },
      });
      console.log();
    },
  });
};

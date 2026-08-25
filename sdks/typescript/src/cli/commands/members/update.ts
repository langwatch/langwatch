import chalk from "chalk";
import { OrganizationApiService } from "@/client-sdk/services/organization/organization-api.service";
import { parseOrganizationRole } from "../../utils/managementFlags";
import type { CommandResult } from "../../utils/output";
import {
  orDash,
  printFacts,
  runManagement,
  withParsedFlags,
} from "../management/_shared";

/**
 * Change a member's organization role. Disabling and re-enabling are their own
 * verbs (`members disable` / `members enable`) because the API takes exactly
 * one of the two changes per request.
 */
export const updateMemberCommand = async ({
  userId,
  options,
}: {
  userId: string;
  options: { role: string };
}): Promise<CommandResult | void> => {
  const role = withParsedFlags(() => parseOrganizationRole(options.role));

  return runManagement({
    action: "update member",
    pending: `Updating member "${userId}"...`,
    run: () => new OrganizationApiService().updateMember({ userId, input: { role } }),
    succeed: (member) => `Member "${userId}" is now ${chalk.cyan(member.role)}`,
    table: (member) => {
      printFacts([
        ["User ID", chalk.gray(member.userId)],
        ["Name", orDash(member.user.name)],
        ["Organization role", chalk.cyan(member.role)],
        ["Status", member.disabled ? chalk.yellow("disabled") : chalk.green("active")],
      ]);
      const orphaned = member.teamsLeftWithoutAdmin ?? [];
      if (orphaned.length > 0) {
        console.log(
          chalk.yellow(
            `  These teams now have no administrator: ${orphaned
              .map((team) => team.name)
              .join(", ")}`,
          ),
        );
        console.log();
      }
    },
  });
};

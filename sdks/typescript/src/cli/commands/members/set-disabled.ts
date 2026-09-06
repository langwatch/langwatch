import chalk from "chalk";
import { OrganizationApiService } from "@/client-sdk/services/organization/organization-api.service";
import type { CommandResult } from "../../utils/output";
import { orDash, printFacts, runManagement } from "../management/_shared";

/**
 * Disabling and re-enabling a member are the same PATCH with a different
 * boolean, so they share an implementation and differ only in the words.
 * Re-enabling consumes a seat, so it is checked against the plan.
 */
const setMemberDisabled = async ({
  userId,
  disabled,
}: {
  userId: string;
  disabled: boolean;
}): Promise<CommandResult | void> =>
  runManagement({
    action: disabled ? "disable member" : "enable member",
    pending: `${disabled ? "Disabling" : "Enabling"} member "${userId}"...`,
    run: () =>
      new OrganizationApiService().updateMember({ userId, input: { disabled } }),
    succeed: (member) =>
      `Member "${userId}" is now ${member.disabled ? chalk.yellow("disabled") : chalk.green("active")}`,
    table: (member) => {
      printFacts([
        ["User ID", chalk.gray(member.userId)],
        ["Name", orDash(member.user.name)],
        ["Email", orDash(member.user.email)],
        ["Status", member.disabled ? chalk.yellow("disabled") : chalk.green("active")],
      ]);
    },
  });

export const disableMemberCommand = (
  userId: string,
): Promise<CommandResult | void> =>
  setMemberDisabled({ userId, disabled: true });

export const enableMemberCommand = (
  userId: string,
): Promise<CommandResult | void> =>
  setMemberDisabled({ userId, disabled: false });

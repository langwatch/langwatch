import chalk from "chalk";
import { GroupsApiService } from "@/client-sdk/services/groups/groups-api.service";
import { formatTable } from "../../utils/formatting";
import type { CommandResult } from "../../utils/output";
import { counted, orDash, printEmpty, runManagement } from "../management/_shared";

export const listGroupMembersCommand = async (
  groupId: string,
): Promise<CommandResult | void> =>
  runManagement({
    action: "list group members",
    pending: `Fetching members of group "${groupId}"...`,
    run: () => new GroupsApiService().listMembers(groupId),
    succeed: (result) =>
      `Found ${counted({ count: result.data.length, singular: "member", plural: "members" })}`,
    table: (result) => {
      if (result.data.length === 0) {
        printEmpty({ what: "group members" });
        return;
      }
      console.log();
      formatTable({
        data: result.data.map((member) => ({
          "User ID": member.userId,
          Name: orDash(member.name),
          Email: orDash(member.email),
        })),
        headers: ["User ID", "Name", "Email"],
        colorMap: { "User ID": chalk.gray, Name: chalk.cyan },
      });
      console.log();
    },
  });

export const addGroupMemberCommand = async ({
  groupId,
  userId,
}: {
  groupId: string;
  userId: string;
}): Promise<CommandResult | void> =>
  runManagement({
    action: "add group member",
    pending: `Adding member "${userId}" to group "${groupId}"...`,
    run: () => new GroupsApiService().addMember({ groupId, input: { userId } }),
    succeed: () => `Added member "${userId}" to group "${groupId}"`,
    table: () => {
      console.log();
      console.log(
        chalk.gray("The member now has everything the group's bindings grant."),
      );
      console.log();
    },
  });

export const removeGroupMemberCommand = async ({
  groupId,
  userId,
}: {
  groupId: string;
  userId: string;
}): Promise<CommandResult | void> =>
  runManagement({
    action: "remove group member",
    pending: `Removing member "${userId}" from group "${groupId}"...`,
    run: () => new GroupsApiService().removeMember({ groupId, userId }),
    succeed: () => `Removed member "${userId}" from group "${groupId}"`,
    table: () => {
      console.log();
      console.log(
        chalk.gray("The member loses the access this group granted them."),
      );
      console.log();
    },
  });

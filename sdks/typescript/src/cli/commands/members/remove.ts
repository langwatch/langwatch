import chalk from "chalk";
import { OrganizationApiService } from "@/client-sdk/services/organization/organization-api.service";
import type { CommandResult } from "../../utils/output";
import { runManagement } from "../management/_shared";

/**
 * Remove a member from the organization and every team in it. The response is
 * a bare `{ success }`, so the id is carried alongside it: a machine caller
 * needs to know WHICH member was removed.
 */
export const removeMemberCommand = async (
  userId: string,
): Promise<CommandResult | void> =>
  runManagement({
    action: "remove member",
    pending: `Removing member "${userId}"...`,
    run: async () => ({
      userId,
      ...(await new OrganizationApiService().removeMember(userId)),
    }),
    succeed: () => `Removed member "${userId}"`,
    table: () => {
      console.log();
      console.log(
        chalk.gray(
          "The member no longer belongs to the organization or any of its teams.",
        ),
      );
      console.log();
    },
  });

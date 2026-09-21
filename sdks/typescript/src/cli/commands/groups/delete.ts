import chalk from "chalk";
import { GroupsApiService } from "@/client-sdk/services/groups/groups-api.service";
import type { CommandResult } from "../../utils/output";
import { runManagement } from "../management/_shared";

export const deleteGroupCommand = async (
  id: string,
): Promise<CommandResult | void> =>
  runManagement({
    action: "delete group",
    pending: `Deleting group "${id}"...`,
    run: () => new GroupsApiService().delete(id),
    succeed: () => `Deleted group "${id}"`,
    table: () => {
      console.log();
      console.log(
        chalk.gray(
          "Its members lose the access the group granted; their other bindings are untouched.",
        ),
      );
      console.log();
    },
  });

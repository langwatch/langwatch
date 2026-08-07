import chalk from "chalk";
import { GroupsApiService } from "@/client-sdk/services/groups/groups-api.service";
import type { CommandResult } from "../../utils/output";
import { printFacts, runManagement } from "../management/_shared";

/**
 * Rename a group. A group an identity provider owns is renamed there, not
 * here, and the platform refuses the write rather than letting the two names
 * diverge until the next sync.
 */
export const renameGroupCommand = async (
  id: string,
  options: { name: string },
): Promise<CommandResult | void> =>
  runManagement({
    action: "rename group",
    pending: `Renaming group "${id}"...`,
    run: () => new GroupsApiService().rename(id, { name: options.name }),
    succeed: (group) => `Renamed group to "${chalk.cyan(group.name)}"`,
    table: (group) => {
      printFacts([
        ["ID", chalk.gray(group.id)],
        ["Name", chalk.cyan(group.name)],
        ["Slug", group.slug],
      ]);
    },
  });

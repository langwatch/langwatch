import chalk from "chalk";
import { GroupsApiService } from "@/client-sdk/services/groups/groups-api.service";
import { formatTable } from "../../utils/formatting";
import type { CommandResult } from "../../utils/output";
import { orDash, printFacts, runManagement } from "../management/_shared";

export const getGroupCommand = async (
  id: string,
): Promise<CommandResult | void> =>
  runManagement({
    action: "fetch group",
    pending: `Fetching group "${id}"...`,
    run: () => new GroupsApiService().get(id),
    succeed: (group) => `Group "${chalk.cyan(group.name)}"`,
    table: (group) => {
      printFacts([
        ["ID", chalk.gray(group.id)],
        ["Name", chalk.cyan(group.name)],
        ["Slug", group.slug],
        ["Managed by", orDash(group.scimSource)],
        ["Members", String(group.members.length)],
        ["Bindings", String(group.bindings.length)],
      ]);
      if (group.bindings.length > 0) {
        formatTable({
          data: group.bindings.map((binding) => ({
            "Binding ID": binding.id,
            Role: binding.customRoleName ?? binding.role,
            Scope: `${binding.scopeType} ${binding.scopeId}`,
          })),
          headers: ["Binding ID", "Role", "Scope"],
          colorMap: { "Binding ID": chalk.gray, Role: chalk.cyan },
        });
        console.log();
      }
    },
  });

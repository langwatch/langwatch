import chalk from "chalk";
import { GroupsApiService } from "@/client-sdk/services/groups/groups-api.service";
import { parseBindingFlags } from "../../utils/managementFlags";
import type { CommandResult } from "../../utils/output";
import { printFacts, runManagement, withParsedFlags } from "../management/_shared";

export interface CreateGroupOptions {
  name: string;
  binding?: string[];
  memberId?: string[];
}

export const createGroupCommand = async (
  options: CreateGroupOptions,
): Promise<CommandResult | void> => {
  const bindings = withParsedFlags(() => parseBindingFlags(options.binding));

  return runManagement({
    action: "create group",
    pending: `Creating group "${options.name}"...`,
    run: () =>
      new GroupsApiService().create({
        name: options.name,
        ...(bindings.length > 0 ? { bindings } : {}),
        ...(options.memberId?.length ? { memberIds: options.memberId } : {}),
      }),
    succeed: (group) => `Created group "${chalk.cyan(group.name)}"`,
    table: (group) => {
      printFacts([
        ["ID", chalk.gray(group.id)],
        ["Name", chalk.cyan(group.name)],
        ["Slug", group.slug],
      ]);
    },
  });
};

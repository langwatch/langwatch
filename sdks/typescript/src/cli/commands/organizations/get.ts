import chalk from "chalk";
import type { CommandResult } from "../../utils/output";
import { asDate, printFacts, runManagement } from "../management/_shared";
import { instanceAdminService, requireInstanceKey } from "./_shared";

export const getOrganizationByIdCommand = async ({
  id,
  options = {},
}: {
  id: string;
  options?: { instanceKey?: string };
}): Promise<CommandResult | void> => {
  const instanceKey = requireInstanceKey(options.instanceKey);

  return runManagement({
    requiresCredentials: false,
    action: "fetch organization",
    pending: `Fetching organization "${id}"...`,
    run: () => instanceAdminService(instanceKey).get(id),
    succeed: (result) => `Organization "${chalk.cyan(result.organization.name)}"`,
    table: (result) => {
      printFacts([
        ["ID", chalk.gray(result.organization.id)],
        ["Name", chalk.cyan(result.organization.name)],
        ["Slug", result.organization.slug],
        ["Created", asDate(result.organization.createdAt)],
      ]);
    },
  });
};

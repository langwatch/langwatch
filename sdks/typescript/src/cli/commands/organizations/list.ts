import chalk from "chalk";
import { formatTable } from "../../utils/formatting";
import type { CommandResult } from "../../utils/output";
import { asDate, counted, printEmpty, runManagement } from "../management/_shared";
import { instanceAdminService, requireInstanceKey } from "./_shared";

export const listOrganizationsCommand = async (
  options: { instanceKey?: string } = {},
): Promise<CommandResult | void> => {
  const instanceKey = requireInstanceKey(options.instanceKey);

  return runManagement({
    requiresCredentials: false,
    action: "list organizations",
    pending: "Fetching organizations...",
    run: () => instanceAdminService(instanceKey).list(),
    succeed: (result) =>
      `Found ${counted(result.organizations.length, "organization", "organizations")}`,
    table: (result) => {
      if (result.organizations.length === 0) {
        printEmpty({
          what: "organizations",
          hint: 'langwatch organizations create --name "Acme"',
        });
        return;
      }
      console.log();
      formatTable({
        data: result.organizations.map((organization) => ({
          ID: organization.id,
          Name: organization.name,
          Slug: organization.slug,
          Created: asDate(organization.createdAt),
        })),
        headers: ["ID", "Name", "Slug", "Created"],
        colorMap: { ID: chalk.gray, Name: chalk.cyan },
      });
      console.log();
    },
  });
};

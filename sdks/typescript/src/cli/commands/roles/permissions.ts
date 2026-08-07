import chalk from "chalk";
import { RolesApiService } from "@/client-sdk/services/roles/roles-api.service";
import { formatTable } from "../../utils/formatting";
import type { CommandResult } from "../../utils/output";
import { counted, runManagement } from "../management/_shared";

/**
 * The permission catalog custom roles are built from. The organization-scope
 * column matters: a permission marked there only takes effect on an
 * organization-scoped binding, so a team- or project-scoped binding carrying
 * it is refused at write time.
 */
export const rolePermissionsCommand = async (): Promise<CommandResult | void> =>
  runManagement({
    action: "fetch the permission catalog",
    pending: "Fetching the permission catalog...",
    run: () => new RolesApiService().permissions(),
    succeed: (catalog) =>
      `${counted(catalog.resources.length, "resource", "resources")} × ${counted(
        catalog.actions.length,
        "action",
        "actions",
      )}`,
    table: (catalog) => {
      console.log();
      formatTable({
        data: catalog.resources.map((resource) => ({
          Resource: resource.resource,
          "Organization scope only": resource.organizationExclusive
            ? chalk.yellow("yes")
            : chalk.gray("no"),
          Actions: resource.actions.join(", "),
        })),
        headers: ["Resource", "Organization scope only", "Actions"],
        colorMap: { Resource: chalk.cyan },
      });
      console.log();
      console.log(
        chalk.gray(
          "Use these as --permission resource:action when creating or updating a role.",
        ),
      );
      console.log();
    },
  });

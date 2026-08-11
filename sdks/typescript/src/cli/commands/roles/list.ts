import chalk from "chalk";
import { RolesApiService } from "@/client-sdk/services/roles/roles-api.service";
import { formatTable } from "../../utils/formatting";
import type { CommandResult } from "../../utils/output";
import { counted, orDash, printEmpty, runManagement } from "../management/_shared";

export const listRolesCommand = async (): Promise<CommandResult | void> =>
  runManagement({
    action: "list custom roles",
    pending: "Fetching custom roles...",
    run: () => new RolesApiService().list(),
    succeed: (result) =>
      `Found ${counted({ count: result.roles.length, singular: "custom role", plural: "custom roles" })}`,
    table: (result) => {
      if (result.roles.length === 0) {
        printEmpty({
          what: "custom roles",
          hint: 'langwatch roles create --name "Analyst" --permission project:view',
        });
        return;
      }
      console.log();
      formatTable({
        data: result.roles.map((role) => ({
          ID: role.id,
          Name: role.name,
          Description: orDash(role.description),
          Permissions: String(role.permissions.length),
        })),
        headers: ["ID", "Name", "Description", "Permissions"],
        colorMap: { ID: chalk.gray, Name: chalk.cyan },
      });
      console.log();
    },
  });

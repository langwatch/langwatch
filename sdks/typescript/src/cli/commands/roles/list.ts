import chalk from "chalk";

import { RolesApiService } from "@/client-sdk/services/roles/roles-api.service";

import { formatTable } from "../../utils/formatting";
import type { CommandResult } from "../../utils/output";
import { counted, orDash, printEmpty, runManagement } from "../management/_shared";

/** `builtIn` true lists only admin, member and viewer; false only custom roles; omitted, both. */
export const listRolesCommand = async ({
  builtIn,
}: { builtIn?: boolean } = {}): Promise<CommandResult | void> =>
  runManagement({
    action: "list roles",
    pending: "Fetching roles...",
    run: () => new RolesApiService().list({ builtIn }),
    succeed: (result) =>
      `Found ${counted({ count: result.roles.length, singular: "role", plural: "roles" })}`,
    table: (result) => {
      if (result.roles.length === 0) {
        printEmpty({
          what: "roles",
          hint: 'langwatch roles create --name "Analyst" --permission project:view',
        });
        return;
      }
      console.log();
      formatTable({
        data: result.roles.map((role) => ({
          ID: role.id,
          Name: role.name,
          "Built in": role.builtIn ? "yes" : "no",
          Description: orDash(role.description),
          Permissions: String(role.permissions.length),
        })),
        headers: ["ID", "Name", "Built in", "Description", "Permissions"],
        colorMap: { ID: chalk.gray, Name: chalk.cyan },
      });
      console.log();
    },
  });

import chalk from "chalk";

import { GrantsApiService } from "@/client-sdk/services/grants/grants-api.service";

import type { CommandResult } from "../../utils/output";
import { runManagement } from "../management/_shared";
import { printGrant, principalOf } from "./_shared";

/** The principal and scope are the grant's identity; to move one, revoke and create. */
export const changeGrantRoleCommand = async ({
  id,
  role,
}: {
  id: string;
  role: string;
}): Promise<CommandResult | void> =>
  runManagement({
    action: "change grant role",
    pending: `Changing the role of grant "${id}"...`,
    run: () => new GrantsApiService().changeRole({ id, roleId: role }),
    succeed: (grant) =>
      `Now grants ${chalk.cyan(grant.role.name ?? grant.role.id)} to ${principalOf(grant)}`,
    table: printGrant,
  });

import { GrantsApiService } from "@/client-sdk/services/grants/grants-api.service";

import type { CommandResult } from "../../utils/output";
import { runManagement } from "../management/_shared";
import { printGrant, principalOf, roleOf } from "./_shared";

export const getGrantCommand = async (id: string): Promise<CommandResult | void> =>
  runManagement({
    action: "fetch grant",
    pending: `Fetching grant "${id}"...`,
    run: () => new GrantsApiService().get(id),
    succeed: (grant) => `${principalOf(grant)} holds ${roleOf(grant)}`,
    table: printGrant,
  });

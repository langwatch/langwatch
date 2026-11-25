import { defineChannels } from "@langwatch/process";

import { HttpOrganizationChannels } from "./http/http.organization.channels.ts";
import { MemoryOrganizationChannels } from "./memory/memory.organization.channels.ts";

/** The container builds the tier the stores state and hands it to the module class (§5). */
export const organizationChannels = defineChannels({
  live: HttpOrganizationChannels,
  memory: MemoryOrganizationChannels,
});

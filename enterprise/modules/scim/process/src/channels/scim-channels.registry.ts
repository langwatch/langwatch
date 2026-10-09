// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { defineChannels } from "@langwatch/process";

import { BoundScimChannels } from "./scim.channels.ts";

/** The container builds the tier the stores state and hands it to the module class (§5). */
export const scimChannels = defineChannels({
  live: BoundScimChannels,
  memory: BoundScimChannels,
});

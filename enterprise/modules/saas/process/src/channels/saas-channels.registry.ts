// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { defineChannels } from "@langwatch/process";

import { HttpSaasChannels } from "./http/http.saas.channels.ts";
import { MemorySaasChannels } from "./memory/memory.saas.channels.ts";

/** The container builds the tier the stores state and hands it to the module class (§5). */
export const saasChannels = defineChannels({
  live: HttpSaasChannels,
  memory: MemorySaasChannels,
});

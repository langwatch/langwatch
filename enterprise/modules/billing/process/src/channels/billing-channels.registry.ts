// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { defineChannels } from "@langwatch/process";

import { HttpBillingChannels } from "./http/http.billing.channels.ts";
import { MemoryBillingChannels } from "./memory/memory.billing.channels.ts";

/** The container builds the tier the stores state and hands it to the module class (§5). */
export const billingChannels = defineChannels({
  live: HttpBillingChannels,
  memory: MemoryBillingChannels,
});

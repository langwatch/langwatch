// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { defineRepositories } from "@langwatch/process";

import { LiveBillingRepositories } from "./live/live.billing.repositories.ts";
import { MemoryBillingRepositories } from "./memory/memory.billing.repositories.ts";

export const billingRepositories = defineRepositories({
  live: LiveBillingRepositories,
  memory: MemoryBillingRepositories,
});

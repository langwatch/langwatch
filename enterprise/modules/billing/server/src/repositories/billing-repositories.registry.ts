// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { defineRepositories } from "@langwatch/runtime-composition";
import { MemoryBillingRepositories } from "./memory/memory.billing.repositories.ts";
import { PostgresBillingRepositories } from "./prisma/prisma.billing.repositories.ts";

export const billingRepositories = defineRepositories({
  postgres: PostgresBillingRepositories,
  memory: MemoryBillingRepositories,
});

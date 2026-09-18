// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { defineRepositories } from "@langwatch/kernel";

import { ClickHouseBillingRepositories } from "./clickhouse/clickhouse.billing-clickhouse.repositories.ts";
import { MemoryBillingClickHouseRepositories } from "./memory/memory.billing-clickhouse.repositories.ts";
import { MemoryBillingRepositories } from "./memory/memory.billing.repositories.ts";
import { PostgresBillingRepositories } from "./prisma/prisma.billing.repositories.ts";

export const billingRepositories = defineRepositories({
  live: PostgresBillingRepositories,
  memory: MemoryBillingRepositories,
});

export const billingClickhouseRepositories = defineRepositories({
  live: ClickHouseBillingRepositories,
  memory: MemoryBillingClickHouseRepositories,
});

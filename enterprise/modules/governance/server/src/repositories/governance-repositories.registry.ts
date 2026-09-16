// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { defineRepositories } from "@langwatch/runtime-composition";
import { MemoryGovernanceRepositories } from "./memory/memory.governance.repositories.ts";
import { PostgresGovernanceRepositories } from "./prisma/prisma.governance.repositories.ts";
import { ClickHouseGovernanceRepositories } from "./clickhouse/clickhouse.governance-clickhouse.repositories.ts";
import { MemoryGovernanceClickHouseRepositories } from "./memory/memory.governance-clickhouse.repositories.ts";

export const governanceRepositories = defineRepositories({
  live: PostgresGovernanceRepositories,
  memory: MemoryGovernanceRepositories,
});

export const governanceClickhouseRepositories = defineRepositories({
  live: ClickHouseGovernanceRepositories,
  memory: MemoryGovernanceClickHouseRepositories,
});

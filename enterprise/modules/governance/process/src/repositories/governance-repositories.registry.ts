// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { defineRepositories } from "@langwatch/kernel";

import { ClickHouseGovernanceRepositories } from "./clickhouse/clickhouse.governance-clickhouse.repositories.ts";
import { LiveGovernanceRepositories } from "./live/live.governance.repositories.ts";
import { MemoryGovernanceClickHouseRepositories } from "./memory/memory.governance-clickhouse.repositories.ts";
import { MemoryGovernanceRepositories } from "./memory/memory.governance.repositories.ts";

export const governanceRepositories = defineRepositories({
  live: LiveGovernanceRepositories,
  memory: MemoryGovernanceRepositories,
});

export const governanceClickhouseRepositories = defineRepositories({
  live: ClickHouseGovernanceRepositories,
  memory: MemoryGovernanceClickHouseRepositories,
});

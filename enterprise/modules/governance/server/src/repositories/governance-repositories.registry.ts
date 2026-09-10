// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { defineRepositories } from "@langwatch/runtime-composition";
import { MemoryGovernanceRepositories } from "./memory/memory.governance.repositories.ts";
import { PostgresGovernanceRepositories } from "./prisma/prisma.governance.repositories.ts";

export const governanceRepositories = defineRepositories({
  postgres: PostgresGovernanceRepositories,
  memory: MemoryGovernanceRepositories,
});

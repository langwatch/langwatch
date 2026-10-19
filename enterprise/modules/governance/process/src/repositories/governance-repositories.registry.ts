// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { defineRepositories } from "@langwatch/process";

import { LiveGovernanceRepositories } from "./live/live.governance.repositories.ts";
import { MemoryGovernanceRepositories } from "./memory/memory.governance.repositories.ts";

export const governanceRepositories = defineRepositories({
  live: LiveGovernanceRepositories,
  memory: MemoryGovernanceRepositories,
});

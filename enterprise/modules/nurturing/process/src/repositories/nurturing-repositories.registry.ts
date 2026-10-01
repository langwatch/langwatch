// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { defineRepositories } from "@langwatch/kernel";

import { MemoryNurturingRepositories } from "./memory/memory.nurturing.repositories.ts";
import { PostgresNurturingRepositories } from "./prisma/prisma.nurturing.repositories.ts";

export const nurturingRepositories = defineRepositories({
  live: PostgresNurturingRepositories,
  memory: MemoryNurturingRepositories,
});

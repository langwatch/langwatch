// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { defineRepositories } from "@langwatch/process";

import { MemoryScimRepositories } from "./memory/memory.scim.repositories.ts";
import { PostgresScimRepositories } from "./prisma/prisma.scim.repositories.ts";

/** Which backend the process selected; the module never decides it. */
export const scimRepositories = defineRepositories({
  live: PostgresScimRepositories,
  memory: MemoryScimRepositories,
});

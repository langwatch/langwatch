// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { defineRepositories } from "@langwatch/kernel";

import { MemoryDigestRepositories } from "./memory/memory.digest.repositories.ts";
import { PostgresDigestRepositories } from "./prisma/prisma.digest.repositories.ts";

export const digestRepositories = defineRepositories({
  live: PostgresDigestRepositories,
  memory: MemoryDigestRepositories,
});

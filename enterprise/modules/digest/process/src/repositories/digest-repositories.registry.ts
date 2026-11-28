// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { defineRepositories } from "@langwatch/process";

import { LiveDigestRepositories } from "./live/live.digest.repositories.ts";
import { MemoryDigestRepositories } from "./memory/memory.digest.repositories.ts";

export const digestRepositories = defineRepositories({
  live: LiveDigestRepositories,
  memory: MemoryDigestRepositories,
});

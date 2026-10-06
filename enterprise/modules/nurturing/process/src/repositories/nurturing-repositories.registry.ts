// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { defineRepositories } from "@langwatch/process";

import { LiveNurturingRepositories } from "./live/live.nurturing.repositories.ts";
import { MemoryNurturingRepositories } from "./memory/memory.nurturing.repositories.ts";

export const nurturingRepositories = defineRepositories({
  live: LiveNurturingRepositories,
  memory: MemoryNurturingRepositories,
});

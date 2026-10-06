// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { defineRepositories } from "@langwatch/process";

import { LiveSaasRepositories } from "./live/live.saas.repositories.ts";
import { MemorySaasRepositories } from "./memory/memory.saas.repositories.ts";

export const saasRepositories = defineRepositories({
  live: LiveSaasRepositories,
  memory: MemorySaasRepositories,
});

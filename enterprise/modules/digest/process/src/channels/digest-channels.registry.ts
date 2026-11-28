// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { defineChannels } from "@langwatch/process";

import { HttpDigestChannels } from "./http/http.digest.channels.ts";
import { MemoryDigestChannels } from "./memory/memory.digest.channels.ts";

/** The container builds the tier the stores state and hands it to the module class (§5). */
export const digestChannels = defineChannels({
  live: HttpDigestChannels,
  memory: MemoryDigestChannels,
});

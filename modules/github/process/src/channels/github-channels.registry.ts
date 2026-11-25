import { defineChannels } from "@langwatch/process";

import { HttpGithubChannels } from "./http/http.github.channels.ts";
import { MemoryGithubChannels } from "./memory/memory.github.channels.ts";

/** The container builds the tier the stores state and hands it to the module class (§5). */
export const githubChannels = defineChannels({
  live: HttpGithubChannels,
  memory: MemoryGithubChannels,
});

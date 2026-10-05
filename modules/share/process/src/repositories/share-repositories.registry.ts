import { defineRepositories } from "@langwatch/process";

import { LiveShareRepositories } from "./live/live.share.repositories.ts";
import { MemoryShareRepositories } from "./memory/memory.share.repositories.ts";

export const shareRepositories = defineRepositories({
  live: LiveShareRepositories,
  memory: MemoryShareRepositories,
});

import { HttpUserChangelogChannel } from "./http/http.user-changelog.channel.ts";
import { MemoryUserChangelogChannel } from "./memory/memory.user-changelog.channel.ts";

export const userChangelogChannels = {
  http: HttpUserChangelogChannel,
  memory: MemoryUserChangelogChannel,
};

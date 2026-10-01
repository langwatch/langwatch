import { HttpGithubApiAdapter } from "./http/http.github-api.channel.ts";
import { MemoryGithubApiAdapter } from "./memory/memory.github-api.channel.ts";

export const githubApiChannels = {
  live: HttpGithubApiAdapter,
  memory: MemoryGithubApiAdapter,
};

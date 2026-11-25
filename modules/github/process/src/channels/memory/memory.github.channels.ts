import type { GithubChannels } from "../github.channels.ts";
import { MemoryGithubApiAdapter } from "./memory.github-api.channel.ts";

/** The GitHub App is answered in-process from the installations and pull requests a test seeds. */
export class MemoryGithubChannels {
  static readonly requires = [] as const;

  static create(): GithubChannels {
    return { api: MemoryGithubApiAdapter.create() };
  }
}

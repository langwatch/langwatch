import type { SlackChannels } from "../slack.channels.ts";
import { MemorySlackWebApiChannel } from "./memory.slack-web-api.channel.ts";

/** Workspace identities are answered in-process from the tokens a test accepts. */
export class MemorySlackChannels {
  static readonly requires = [] as const;

  static create(): SlackChannels {
    return { webApi: MemorySlackWebApiChannel.create() };
  }
}

import type { SlackServerConfig } from "@langwatch/slack-contract";

import type { SlackChannels } from "../slack.channels.ts";
import { HttpSlackWebApiChannel } from "./http.slack-web-api.channel.ts";

/** Workspace identities are asked of Slack's Web API over HTTP. */
export class HttpSlackChannels {
  static readonly requires = [] as const;

  static create({ config }: { config: SlackServerConfig }): SlackChannels {
    return { webApi: HttpSlackWebApiChannel.create({ apiBase: config.slackApiBase }) };
  }
}

import { Config, slackApiBase, type ConfigOf } from "@langwatch/config";

/** Where Slack's Web API is reached (the shared leaf); haven points it at outboundsim. */
export const slackConfig = Config.define(() => ({ slackApiBase }));

export type SlackServerConfig = ConfigOf<typeof slackConfig>;

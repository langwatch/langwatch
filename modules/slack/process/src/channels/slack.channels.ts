import type { SlackWebApiChannel } from "./slack-web-api.channel.ts";

/** Every channel slack holds, as the container hands them to the module class. */
export interface SlackChannels {
  readonly webApi: SlackWebApiChannel;
}

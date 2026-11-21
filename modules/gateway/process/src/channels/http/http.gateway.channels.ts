import type { BoundApis } from "@langwatch/process";
import { UserApi } from "@langwatch/user-contract";

import type { GatewayChannels } from "../gateway.channels.ts";
import { HttpElevenLabsConversationChannel } from "./http.elevenlabs-conversation.channel.ts";
import { HttpGatewayUserDirectoryChannel } from "./http.gateway-user-directory.channel.ts";

/**
 * Realtime conversations are read from ElevenLabs behind the egress fence. Accounts are asked of
 * the user module through a binding, not a peer, so it orders nothing and adds no edge.
 */
export class HttpGatewayChannels {
  static readonly requires = [] as const;
  static readonly binds = { users: UserApi } as const;

  static create({
    bound,
  }: {
    bound: BoundApis<typeof HttpGatewayChannels.binds>;
  }): GatewayChannels {
    return {
      conversations: HttpElevenLabsConversationChannel.create(),
      users: HttpGatewayUserDirectoryChannel.create({ users: bound.users }),
    };
  }
}

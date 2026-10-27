import {
  ModelProviderConnectionPing,
  type ModelProviderPingReply,
  type ModelProviderPingRequest,
} from "../model-provider-connection-ping.channel.ts";

/** One scripted reply to every ping, keeping what it was sent, for suites with no vendor. */
export class MemoryModelProviderConnectionPingChannel extends ModelProviderConnectionPing {
  readonly sent: ModelProviderPingRequest[] = [];

  private constructor(private readonly reply: ModelProviderPingReply) {
    super();
  }

  static create(
    reply: ModelProviderPingReply = { outcome: "generated" },
  ): MemoryModelProviderConnectionPingChannel {
    return new MemoryModelProviderConnectionPingChannel(reply);
  }

  async ping(request: ModelProviderPingRequest): Promise<ModelProviderPingReply> {
    this.sent.push(request);
    return this.reply;
  }
}

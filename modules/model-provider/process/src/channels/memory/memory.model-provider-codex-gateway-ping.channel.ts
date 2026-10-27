import {
  ModelProviderCodexGatewayPing,
  type ModelProviderCodexGatewayPingRequest,
} from "../model-provider-codex-gateway-ping.channel.ts";
import type { ModelProviderPingReply } from "../model-provider-connection-ping.channel.ts";

/** One scripted reply to every Codex ping, keeping what it was sent, for suites with no gateway. */
export class MemoryModelProviderCodexGatewayPingChannel extends ModelProviderCodexGatewayPing {
  readonly sent: ModelProviderCodexGatewayPingRequest[] = [];

  private constructor(private readonly reply: ModelProviderPingReply) {
    super();
  }

  static create(
    reply: ModelProviderPingReply = { outcome: "generated" },
  ): MemoryModelProviderCodexGatewayPingChannel {
    return new MemoryModelProviderCodexGatewayPingChannel(reply);
  }

  async ping(request: ModelProviderCodexGatewayPingRequest): Promise<ModelProviderPingReply> {
    this.sent.push(request);
    return this.reply;
  }
}

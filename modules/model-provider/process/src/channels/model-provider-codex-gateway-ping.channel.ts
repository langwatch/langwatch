import type { ModelProviderPingReply } from "./model-provider-connection-ping.channel.ts";

export type ModelProviderCodexGatewayPingRequest = Readonly<{
  /** The full id (`openai_codex/<model>`): the gateway routes to Codex by the prefix. */
  model: string;
  /** The project's gateway virtual key, the one Langy reaches Codex with. */
  virtualKey: string;
}>;

/** One token of generation through the AI gateway's Responses endpoint, Codex's only road. */
export abstract class ModelProviderCodexGatewayPing {
  abstract ping(request: ModelProviderCodexGatewayPingRequest): Promise<ModelProviderPingReply>;
}

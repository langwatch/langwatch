import type { AgentApi } from "@langwatch/agent-contract";
import { createAgentWebSocketProtocol } from "@langwatch/agent-server";
import type { ConnectUpgradeRouterPort } from "@langwatch/api";

export class ApiConnectedAgentsComposition {
  readonly #agents: AgentApi;
  readonly #protocol;

  static create(options: {
    agents: AgentApi;
    relayMaxPayloadMb?: number;
  }): ApiConnectedAgentsComposition {
    return new ApiConnectedAgentsComposition(options);
  }

  private constructor(options: { agents: AgentApi; relayMaxPayloadMb?: number }) {
    this.#agents = options.agents;
    this.#protocol = createAgentWebSocketProtocol(options.relayMaxPayloadMb);
  }

  mount(router: ConnectUpgradeRouterPort): void {
    this.#protocol.mount(router, this.#agents);
  }

  close(): Promise<void> {
    return this.#protocol.close();
  }
}

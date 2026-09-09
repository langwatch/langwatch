import { agentConnectCredentialsSchema, relayPayloadCaps } from "@langwatch/agent-contract";
import { WebSocketProtocol, type ConnectUpgradeRouterPort } from "@langwatch/api";
import {
  AgentSessionService,
  type SessionCoreOptions,
} from "../../services/connected-agent-session.service.ts";
import { ConnectedAgentConnectionService } from "../../services/connected-agent-connection.service.ts";
import { CONNECT_PATH } from "../agent-connect.ws.ts";

export class ConnectGatewayFixture {
  readonly #connections;
  readonly #protocol;

  static create(options: SessionCoreOptions & { pingIntervalMs?: number; pongWaitMs?: number }) {
    return new ConnectGatewayFixture(options);
  }

  private constructor(
    options: SessionCoreOptions & { pingIntervalMs?: number; pongWaitMs?: number },
  ) {
    this.#connections = ConnectedAgentConnectionService.create({
      session: AgentSessionService.create(options),
      pingIntervalMs: options.pingIntervalMs,
      pongWaitMs: options.pongWaitMs,
    });
    this.#protocol = WebSocketProtocol.create({
      path: CONNECT_PATH,
      maxPayloadBytes: relayPayloadCaps(options.relayMaxPayloadMb).frameBytes,
      facts: agentConnectCredentialsSchema,
      headers: {
        authorization: "authorization",
        projectId: "x-project-id",
        instanceToken: "x-agent-instance-token",
      },
      handle: (connections: ConnectedAgentConnectionService, socket, credentials) =>
        connections.accept(socket, credentials),
    });
  }

  get sessionCount() {
    return this.#connections.sessionCount;
  }
  mount(router: ConnectUpgradeRouterPort) {
    this.#protocol.mount(router, this.#connections);
  }
  async close() {
    await this.#connections.close();
    await this.#protocol.close();
  }
}

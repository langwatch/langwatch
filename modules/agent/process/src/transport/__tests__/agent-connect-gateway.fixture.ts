import {
  type AgentConnectCaller,
  agentConnectHeadersSchema,
  relayPayloadCaps,
} from "@langwatch/agent-contract";
import { WebSocketProtocol, type ConnectUpgradeRouter } from "@langwatch/api";

import { ConnectedAgentConnectionService } from "../../services/connected-agent-connection.service.ts";
import {
  AgentSessionService,
  type SessionCoreOptions,
} from "../../services/connected-agent-session.service.ts";
import { CONNECT_PATH } from "../agent-connect.ws.ts";

/** The caller stands in for the door's answer: the door itself is packages/api's to test. */
type GatewayOptions = SessionCoreOptions & {
  caller?: AgentConnectCaller;
  pingIntervalMs?: number;
  pongWaitMs?: number;
};

const DEFAULT_CALLER: AgentConnectCaller = {
  project: { id: "proj_1", slug: "proj-one" },
  principalId: "key:test",
  userId: null,
};

export class ConnectGatewayFixture {
  readonly #connections;
  readonly #protocol;

  static create(options: GatewayOptions) {
    return new ConnectGatewayFixture(options);
  }

  private constructor(options: GatewayOptions) {
    this.#connections = ConnectedAgentConnectionService.create({
      session: AgentSessionService.create(options),
      pingIntervalMs: options.pingIntervalMs,
      pongWaitMs: options.pongWaitMs,
    });
    this.#protocol = WebSocketProtocol.create({
      path: CONNECT_PATH,
      maxPayloadBytes: relayPayloadCaps(options.relayMaxPayloadMb).frameBytes,
      middlewareContext: agentConnectHeadersSchema,
      headers: { instanceToken: "x-agent-instance-token" },
      handle: (connections: ConnectedAgentConnectionService, socket, context) => {
        connections.accept(socket, {
          admitted: { ...context, caller: options.caller ?? DEFAULT_CALLER },
        });
        return Promise.resolve();
      },
    });
  }

  get sessionCount() {
    return this.#connections.sessionCount;
  }
  mount(router: ConnectUpgradeRouter) {
    this.#protocol.mount(router, this.#connections);
  }
  async close() {
    await this.#connections.close();
    await this.#protocol.close();
  }
}

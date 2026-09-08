import {
  AgentApi,
  agentConnectCredentialsSchema,
  relayPayloadCaps,
} from "@langwatch/agent-contract";
import { WebSocketProtocol } from "@langwatch/api";

export const CONNECT_PATH = "/api/v1/agents/connect";

export function createAgentWebSocketProtocol(relayMaxPayloadMb?: number) {
  return WebSocketProtocol.create({
    path: CONNECT_PATH,
    maxPayloadBytes: relayPayloadCaps(relayMaxPayloadMb).frameBytes,
    facts: agentConnectCredentialsSchema,
    headers: {
      authorization: "authorization",
      projectId: "x-project-id",
      instanceToken: "x-agent-instance-token",
    },
    handle: (app: AgentApi, connection, credentials) =>
      app.acceptConnection(connection, credentials),
  });
}

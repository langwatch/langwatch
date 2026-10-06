import {
  type AgentApi,
  AgentRegisterRefusedError,
  agentConnectHeadersSchema,
  relayPayloadCaps,
} from "@langwatch/agent-contract";
import { type ProtocolConnection, type WebSocketCaller, WebSocketProtocol } from "@langwatch/api";
import type { z } from "zod";

import {
  CONNECT_KEY_KINDS,
  CONNECT_PERMISSION,
  connectCallerOf,
} from "../rules/agent-connect-caller.rules.ts";
import { connectRefusalOf } from "../rules/agent-connect-refusal.rules.ts";

export const CONNECT_PATH = "/api/v1/agents/connect";

/** The door answers at upgrade; either way the socket opens, so a refusal is a refused frame. */
export function createAgentWebSocketProtocol(
  relayMaxPayloadMb?: number,
): WebSocketProtocol<AgentApi, typeof agentConnectHeadersSchema> {
  return WebSocketProtocol.create({
    path: CONNECT_PATH,
    maxPayloadBytes: relayPayloadCaps(relayMaxPayloadMb).frameBytes,
    facts: agentConnectHeadersSchema,
    headers: { instanceToken: "x-agent-instance-token" },
    door: { credential: "project", permission: CONNECT_PERMISSION, keyKinds: CONNECT_KEY_KINDS },
    handle: (
      app: AgentApi,
      connection: ProtocolConnection,
      {
        facts,
        caller,
      }: { facts: z.output<typeof agentConnectHeadersSchema>; caller: WebSocketCaller },
    ) =>
      app.acceptConnection(connection, {
        admitted: { ...facts, caller: connectCallerOf(caller.credential) },
      }),
    refuse: (app: AgentApi, connection: ProtocolConnection, failure: Error) =>
      app.acceptConnection(connection, { refused: protocolRefusalOf(failure) }),
  });
}

/** A door refusal as the protocol's own refused frame; anything unframed is passed on as it is. */
function protocolRefusalOf(failure: Error): Error {
  const door = connectRefusalOf(failure);

  return door.framed ? new AgentRegisterRefusedError(door.refusal) : failure;
}

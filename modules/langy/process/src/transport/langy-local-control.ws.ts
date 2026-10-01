/**
 * The local folder's socket, `GET /api/v1/langy/control/connect` (ADR-129 "Transport"), as on
 * main. The session key and project ride the upgrade's own headers; every refusal is a frame.
 */

import { WebSocketProtocol } from "@langwatch/api";
import { type LangyApi, localControlConnectCredentialsSchema } from "@langwatch/langy-contract";

export const CONTROL_CONNECT_PATH = "/api/v1/langy/control/connect";

const MAX_FRAME_BYTES = 8 * 1024 * 1024;

export function createLangyLocalControlWebSocketProtocol(): WebSocketProtocol<
  LangyApi,
  typeof localControlConnectCredentialsSchema
> {
  return WebSocketProtocol.create({
    path: CONTROL_CONNECT_PATH,
    maxPayloadBytes: MAX_FRAME_BYTES,
    facts: localControlConnectCredentialsSchema,
    headers: { authorization: "authorization", projectId: "x-project-id" },
    handle: (app: LangyApi, connection, credentials) =>
      app.acceptLocalControlConnection(connection, credentials),
  });
}

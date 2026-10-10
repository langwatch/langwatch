/**
 * The local folder's socket, `GET /api/v1/langy/control/connect` (ADR-129 "Transport"), as on
 * main. Langy's session key door admits the upgrade; every refusal is a frame.
 */

import {
  type ProtocolConnection,
  type WebSocketSessionCaller,
  WebSocketProtocol,
} from "@langwatch/api";
import { type LangyApi, localControlCredentialSchema } from "@langwatch/langy-contract";
import { z } from "zod";

import { sessionKeyRefusalOf } from "../rules/langy-local-control-connect.rules.ts";

export const CONTROL_CONNECT_PATH = "/api/v1/langy/control/connect";

const MAX_FRAME_BYTES = 8 * 1024 * 1024;

const noContext = z.object({});

export function createLangyLocalControlWebSocketProtocol(): WebSocketProtocol<
  LangyApi,
  typeof noContext,
  typeof localControlCredentialSchema
> {
  return WebSocketProtocol.create({
    path: CONTROL_CONNECT_PATH,
    maxPayloadBytes: MAX_FRAME_BYTES,
    middlewareContext: noContext,
    headers: {},
    door: { credential: "session_key", session: localControlCredentialSchema },
    handle: (
      app: LangyApi,
      connection: ProtocolConnection,
      { caller }: { caller: WebSocketSessionCaller<typeof localControlCredentialSchema> },
    ) => app.acceptLocalControlConnection(connection, { admitted: caller.session }),
    // Anything that is not a session key refusal closes 1011, as a failed accept did.
    refuse: async (app: LangyApi, connection: ProtocolConnection, failure: Error) => {
      const door = sessionKeyRefusalOf(failure);
      if (!door.framed) throw failure;
      await app.acceptLocalControlConnection(connection, { refused: door.refusal });
    },
  });
}

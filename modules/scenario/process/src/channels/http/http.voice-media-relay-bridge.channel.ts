import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { createLogger } from "@langwatch/observability";
import WebSocket from "ws";

import { closeToPassOn, frameBytes } from "../../rules/websocket.rules.ts";
import type {
  RelayedUpgrade,
  VoiceMediaRelay,
  VoiceMediaRelayBridgeChannel,
  VoiceMediaRelayFrame,
} from "../voice-media-relay.channels.ts";

const logger = createLogger("langwatch:voice:relay-bridge");

const LOOPBACK_HOST = "127.0.0.1";
/** Bounds the loopback upgrade: the claim, the spawn and the child's handshake. */
const BRIDGE_HANDSHAKE_TIMEOUT_MS = 15_000;
const CLAIM_REFUSED = { code: 1008, reason: "voice_call_refused" };
const BRIDGE_FAILED = { code: 1011, reason: "voice_bridge_failed" };
/** Twilio's stream, ended under a code the loopback socket cannot send, reads as the peer lost. */
const RELAY_PEER_LOST = 4502;

/**
 * A loopback WebSocket stands in for Twilio: its server end is the raw upgrade the claim takes,
 * its client end carries the relay's frames. The door it opens takes one upgrade, on one path,
 * and closes; anything else that connects is dropped.
 */
export class HttpVoiceMediaRelayBridgeChannel implements VoiceMediaRelayBridgeChannel {
  static create(): HttpVoiceMediaRelayBridgeChannel {
    return new HttpVoiceMediaRelayBridgeChannel();
  }

  private constructor() {}

  async bridge({
    relay,
    path,
    twilioSignature,
    onUpgrade,
  }: {
    relay: VoiceMediaRelay;
    path: string;
    twilioSignature: string | undefined;
    onUpgrade: (upgrade: RelayedUpgrade) => void;
  }): Promise<void> {
    const toChild: VoiceMediaRelayFrame[] = [];
    let client: WebSocket | undefined;

    relay.onFrame((frame) => {
      if (client?.readyState === WebSocket.OPEN) {
        client.send(frame.data, { binary: frame.isBinary });
      } else {
        toChild.push(frame);
      }
    });

    const server = loopbackDoor({ path, onUpgrade });
    const port = await listenOnLoopback(server);

    let relayEnded = false;
    relay.onEnd((end) => {
      relayEnded = true;
      server.close();
      if (client?.readyState === WebSocket.OPEN) {
        const { code, reason } = closeToPassOn({ ...end, fallback: RELAY_PEER_LOST });
        client.close(code, reason);
      } else {
        client?.terminate();
      }
    });
    // Twilio may have hung up while the door was binding: then there is nothing to bridge.
    if (relayEnded) return;

    const opened = new WebSocket(`ws://${LOOPBACK_HOST}:${port}${path}`, {
      headers: twilioSignature === undefined ? {} : { "x-twilio-signature": twilioSignature },
      perMessageDeflate: false,
      handshakeTimeout: BRIDGE_HANDSHAKE_TIMEOUT_MS,
    });
    client = opened;
    opened.on("open", () => {
      for (const frame of toChild.splice(0)) opened.send(frame.data, { binary: frame.isBinary });
    });
    opened.on("message", (data, isBinary) => relay.send({ data: frameBytes(data), isBinary }));
    let refused = false;
    opened.on("unexpected-response", (_request, response) => {
      logger.warn(
        { relay: relay.logId, status: response.statusCode },
        "relayed voice call was refused by the claim",
      );
      refused = true;
      relay.close(CLAIM_REFUSED);
      opened.terminate();
    });
    opened.on("error", (error) => {
      // Terminating a refused upgrade raises an error of its own; the refusal is already logged.
      if (refused) return;
      logger.warn({ relay: relay.logId, error }, "relayed voice call bridge failed");
      relay.close(BRIDGE_FAILED);
    });
    opened.on("close", (code, reason) => {
      server.close();
      relay.close(closeToPassOn({ code, reason: reason.toString(), fallback: 1000 }));
    });
  }
}

/** Answers the first upgrade on `path` with `onUpgrade`, then stops listening. */
function loopbackDoor({
  path,
  onUpgrade,
}: {
  path: string;
  onUpgrade: (upgrade: RelayedUpgrade) => void;
}): Server {
  let taken = false;
  const server = createServer((_request, response) => response.writeHead(404).end());
  server.on("upgrade", (request, socket, head) => {
    if (taken || request.url !== path) {
      socket.destroy();
      return;
    }
    taken = true;
    server.close();
    onUpgrade({
      url: path,
      method: request.method ?? "GET",
      headers: request.headers,
      head,
      socket,
    });
  });
  return server;
}

function listenOnLoopback(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, LOOPBACK_HOST, () => resolve((server.address() as AddressInfo).port));
  });
}

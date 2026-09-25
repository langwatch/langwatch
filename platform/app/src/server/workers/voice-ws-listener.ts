/**
 * The voice worker's public media listener.
 *
 * Twilio dials back `wss://<host>/twilio/<nonce>` for every call. This listener
 * owns that public port in the parent worker process: it accepts the upgrade,
 * authenticates the nonce against {@link ../scenarios/voice/voice-nonce-registry},
 * and hands the raw socket to the scenario child that owns the call. It does
 * NOT complete the WebSocket handshake - a live `ws.WebSocket` cannot cross an
 * IPC boundary, so the child completes the handshake against its own `ws` server
 * (slice 2, {@link ../scenarios/voice/voice-socket-handoff}).
 *
 * Everything that is not a `/twilio/<nonce>` upgrade is refused before any audio
 * flows: `/healthz` answers 200, every other request answers 404, an upgrade on
 * a wrong path is closed 404, and an unknown or expired nonce is closed 403 with
 * a warn. The listener boots on every worker process (see
 * `workers/worker-boot-plan.ts`).
 */

import type { ChildProcess } from "node:child_process";
import type { IncomingMessage, ServerResponse } from "node:http";
import http from "node:http";
import type { AddressInfo, Socket } from "node:net";
import type { Duplex } from "node:stream";
import { createLogger, type Logger } from "@langwatch/observability";
import {
  VOICE_MEDIA_UPGRADE_REFUSED_MESSAGE,
  type VoiceMediaUpgradeRefusedMessage,
} from "../scenarios/voice/voice-nonce-handoff";
import type { VoiceNonceRegistry } from "../scenarios/voice/voice-nonce-registry";
import { handOffVoiceSocket } from "../scenarios/voice/voice-socket-handoff";

/** The liveness path, unauthenticated, so a kubelet probe needs no nonce. */
export const VOICE_LISTENER_LIVENESS_PATH = "/healthz";

const TWILIO_UPGRADE_PATH = /^\/twilio\/([^/]+)$/;

/**
 * Extract the nonce from a `/twilio/<nonce>` request path, ignoring any query
 * string, or null when the path is not a media upgrade path.
 */
export function parseTwilioNoncePath(
  rawUrl: string | undefined,
): string | null {
  if (rawUrl === undefined) return null;
  let pathname: string;
  try {
    pathname = new URL(rawUrl, "http://voice.local").pathname;
  } catch {
    return null;
  }
  const match = TWILIO_UPGRADE_PATH.exec(pathname);
  return match?.[1] ?? null;
}

/** The listener's decision for one upgrade request. `notifyChild` on a
 *  reject is present only when a specific child can be told why (an expired
 *  nonce was still associated with one; an unknown nonce never was) — see
 *  {@link ../scenarios/voice/voice-nonce-handoff.raceAgainstUpgradeRefusal}. */
export type VoiceUpgradeDecision =
  | { action: "handoff"; nonce: string; child: ChildProcess }
  | {
      action: "reject";
      status: 404 | 403;
      reason: string;
      notifyChild?: ChildProcess;
    };

/**
 * Decide what to do with an upgrade request: reject a non-media path (404),
 * reject an unknown or expired nonce (403), or hand off to the owning child.
 * Consumes the nonce, so a replay of a just-used nonce reads as unknown.
 */
export function routeVoiceUpgrade(params: {
  url: string | undefined;
  registry: VoiceNonceRegistry;
}): VoiceUpgradeDecision {
  const nonce = parseTwilioNoncePath(params.url);
  if (nonce === null) {
    return {
      action: "reject",
      status: 404,
      reason: "not a media upgrade path",
    };
  }
  const lookup = params.registry.consume(nonce);
  if (!lookup.ok) {
    return {
      action: "reject",
      status: 403,
      reason: `nonce ${lookup.reason}`,
      ...(lookup.reason === "expired" ? { notifyChild: lookup.child } : {}),
    };
  }
  return { action: "handoff", nonce, child: lookup.child };
}

/**
 * Write a bare HTTP status line to a pre-handshake socket, then end it. Uses
 * `socket.end` rather than a `write` followed by `destroy` - destroy can tear
 * the socket down before the write flushes, so the client would see a
 * connection reset instead of the intended status.
 */
function refuseSocket(socket: Duplex, status: 404 | 403): void {
  const reasonPhrase = status === 404 ? "Not Found" : "Forbidden";
  socket.end(`HTTP/1.1 ${status} ${reasonPhrase}\r\nConnection: close\r\n\r\n`);
}

/** The plain-HTTP handler: 200 at the liveness path, 404 for everything else. */
function handleListenerRequest(
  req: IncomingMessage,
  res: ServerResponse,
): void {
  if (req.url === VOICE_LISTENER_LIVENESS_PATH) {
    res.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
    return;
  }
  // Anything that is not the liveness path and not an upgrade is refused before
  // it can reach any handler that touches audio.
  res.writeHead(404, { "Content-Type": "text/plain" }).end("not found");
}

/** Route one upgrade: refuse a bad path or nonce, or hand the socket to the child. */
function handleVoiceUpgrade(params: {
  req: IncomingMessage;
  socket: Duplex;
  head: Buffer;
  registry: VoiceNonceRegistry;
  logger: Logger;
}): void {
  const { req, socket, head, registry, logger } = params;
  const decision = routeVoiceUpgrade({ url: req.url, registry });
  if (decision.action === "reject") {
    logger.warn(
      { url: req.url, status: decision.status, reason: decision.reason },
      "voice media upgrade refused",
    );
    // Best-effort: let the owning child fail its dial fast with the real
    // cause instead of silently burning its full connect-wait timeout. Only
    // ever set for an EXPIRED nonce (see routeVoiceUpgrade) — an unknown
    // nonce has no child to tell.
    if (decision.notifyChild?.send) {
      const notice: VoiceMediaUpgradeRefusedMessage = {
        type: VOICE_MEDIA_UPGRADE_REFUSED_MESSAGE,
        reason: decision.reason,
      };
      decision.notifyChild.send(notice);
    }
    refuseSocket(socket, decision.status);
    return;
  }
  // The upgrade socket is a net.Socket at runtime (the http server's listener is
  // a TCP server); the event types it as the wider Duplex.
  void handOffVoiceSocket({
    child: decision.child,
    socket: socket as unknown as Socket,
    nonce: decision.nonce,
    url: req.url ?? "",
    method: req.method ?? "GET",
    headers: req.headers,
    head,
  })
    .then(() =>
      logger.info(
        { nonce: decision.nonce },
        "voice media socket handed to child",
      ),
    )
    .catch((error: unknown) => {
      logger.error(
        { error, nonce: decision.nonce },
        "voice media socket handoff failed",
      );
      socket.destroy();
    });
}

/** Log the origin Twilio dials, or warn when none is set (tests only). */
function logListenerStarted(params: {
  logger: Logger;
  port: number;
  publicBaseUrl: string | undefined;
}): void {
  if (params.publicBaseUrl === undefined) {
    params.logger.warn(
      { port: params.port },
      "voice media listener started without VOICE_PUBLIC_BASE_URL; no inbound call can be reached",
    );
    return;
  }
  params.logger.info(
    {
      port: params.port,
      dialBack: `wss://${new URL(params.publicBaseUrl).host}/twilio/<nonce>`,
    },
    "voice media listener started",
  );
}

/**
 * Boot the media listener on `port`. Returns the bound server, its address, and
 * a `close` the caller registers for shutdown. When `publicBaseUrl` is set the
 * listener logs the wss origin Twilio will dial; the env layer already refuses
 * to start a voice worker without it, so an unset value here only ever happens
 * in a test.
 */
export async function bootVoiceWsListener(params: {
  port: number;
  publicBaseUrl: string | undefined;
  registry: VoiceNonceRegistry;
  logger?: Logger;
}): Promise<{
  server: http.Server;
  address: AddressInfo;
  close: () => Promise<void>;
}> {
  const logger = params.logger ?? createLogger("langwatch:voice:ws-listener");

  const server = http.createServer(handleListenerRequest);
  server.on("upgrade", (req, socket, head) =>
    handleVoiceUpgrade({
      req,
      socket,
      head,
      registry: params.registry,
      logger,
    }),
  );

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(params.port, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  const address = server.address() as AddressInfo;
  logListenerStarted({
    logger,
    port: address.port,
    publicBaseUrl: params.publicBaseUrl,
  });

  return {
    server,
    address,
    close: () =>
      new Promise<void>((resolve) => {
        // Drop any connection still held by the parent (a rejected upgrade
        // mid-write, or a socket not yet handed off) so shutdown never waits on
        // one; a socket already handed to a child left this process and is
        // unaffected.
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

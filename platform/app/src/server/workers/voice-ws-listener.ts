/**
 * The voice worker's public media listener.
 *
 * Twilio dials back `wss://<host>/twilio/<nonce>` for every call. This listener
 * owns that public port in the parent worker process: it accepts the upgrade,
 * authenticates the nonce against {@link ../scenarios/voice/voice-nonce-registry},
 * and hands the raw socket to the scenario child that owns the call. It does
 * NOT complete the WebSocket handshake — a live `ws.WebSocket` cannot cross an
 * IPC boundary, so the child completes the handshake against its own `ws` server
 * (slice 2, {@link ../scenarios/voice/voice-socket-handoff}).
 *
 * Everything that is not a `/twilio/<nonce>` upgrade is refused before any audio
 * flows: `/healthz` answers 200, every other request answers 404, an upgrade on
 * a wrong path is closed 404, and an unknown or expired nonce is closed 403 with
 * a warn. The listener boots only when VOICE_WORKER_ONLY is on, so it is inert
 * in every default deployment.
 */

import type { ChildProcess } from "node:child_process";
import http from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { createLogger, type Logger } from "@langwatch/observability";
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

/** The listener's decision for one upgrade request. */
export type VoiceUpgradeDecision =
	| { action: "handoff"; nonce: string; child: ChildProcess }
	| { action: "reject"; status: 404 | 403; reason: string };

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
		return { action: "reject", status: 403, reason: `nonce ${lookup.reason}` };
	}
	return { action: "handoff", nonce, child: lookup.child };
}

/** Write a bare HTTP status line to a pre-handshake socket and close it. */
function refuseSocket(
	socket: NodeJS.WritableStream & { destroy: () => void },
	status: 404 | 403,
): void {
	const reasonPhrase = status === 404 ? "Not Found" : "Forbidden";
	socket.write(
		`HTTP/1.1 ${status} ${reasonPhrase}\r\nConnection: close\r\n\r\n`,
	);
	socket.destroy();
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

	const server = http.createServer((req, res) => {
		if (req.url === VOICE_LISTENER_LIVENESS_PATH) {
			res.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
			return;
		}
		// Anything that is not the liveness path and not an upgrade is refused
		// before it can reach any handler that touches audio.
		res.writeHead(404, { "Content-Type": "text/plain" }).end("not found");
	});

	server.on("upgrade", (req, socket, head) => {
		const decision = routeVoiceUpgrade({
			url: req.url,
			registry: params.registry,
		});
		if (decision.action === "reject") {
			logger.warn(
				{ url: req.url, status: decision.status, reason: decision.reason },
				"voice media upgrade refused",
			);
			refuseSocket(socket, decision.status);
			return;
		}
		// The upgrade socket is a net.Socket at runtime (the http server's listener
		// is a TCP server); the event types it as the wider Duplex.
		void handOffVoiceSocket({
			child: decision.child,
			socket: socket as unknown as Socket,
			nonce: decision.nonce,
			url: req.url ?? "",
			method: req.method ?? "GET",
			headers: req.headers,
			head,
		})
			.then(() => {
				logger.info(
					{ nonce: decision.nonce },
					"voice media socket handed to child",
				);
			})
			.catch((error: unknown) => {
				logger.error(
					{ error, nonce: decision.nonce },
					"voice media socket handoff failed",
				);
				socket.destroy();
			});
	});

	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(params.port, () => {
			server.removeListener("error", reject);
			resolve();
		});
	});

	const address = server.address() as AddressInfo;
	if (params.publicBaseUrl === undefined) {
		logger.warn(
			{ port: address.port },
			"voice media listener started without VOICE_PUBLIC_BASE_URL; no inbound call can be reached",
		);
	} else {
		const host = new URL(params.publicBaseUrl).host;
		logger.info(
			{ port: address.port, dialBack: `wss://${host}/twilio/<nonce>` },
			"voice media listener started",
		);
	}

	return {
		server,
		address,
		close: () =>
			new Promise<void>((resolve) => {
				server.close(() => resolve());
			}),
	};
}

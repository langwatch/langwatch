/**
 * @see specs/features/agents/voice-phone.feature
 */

import type { ChildProcess } from "node:child_process";
import http from "node:http";
import type { AddressInfo } from "node:net";
import net from "node:net";
import type { Logger } from "@langwatch/observability";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VoiceNonceRegistry } from "../../scenarios/voice/voice-nonce-registry";
import {
	bootVoiceWsListener,
	parseTwilioNoncePath,
	routeVoiceUpgrade,
} from "../voice-ws-listener";

const silentLogger = {
	info: () => undefined,
	warn: () => undefined,
	error: () => undefined,
} as unknown as Logger;

describe("parseTwilioNoncePath", () => {
	it("returns the nonce for a media path and null otherwise", () => {
		expect(parseTwilioNoncePath("/twilio/abc123")).toBe("abc123");
		expect(parseTwilioNoncePath("/twilio/abc123?foo=bar")).toBe("abc123");
		expect(parseTwilioNoncePath("/twilio/")).toBeNull();
		expect(parseTwilioNoncePath("/twilio/a/b")).toBeNull();
		expect(parseTwilioNoncePath("/healthz")).toBeNull();
		expect(parseTwilioNoncePath(undefined)).toBeNull();
	});
});

describe("routeVoiceUpgrade", () => {
	const fakeChild = { pid: 1 } as unknown as ChildProcess;

	it("rejects a non-media path with 404", () => {
		const registry = new VoiceNonceRegistry();
		expect(routeVoiceUpgrade({ url: "/nope", registry })).toEqual({
			action: "reject",
			status: 404,
			reason: "not a media upgrade path",
		});
	});

	/** @scenario "The media listener refuses an unknown or expired nonce" */
	it("rejects an unknown nonce with 403", () => {
		const registry = new VoiceNonceRegistry();
		expect(routeVoiceUpgrade({ url: "/twilio/missing", registry })).toEqual({
			action: "reject",
			status: 403,
			reason: "nonce unknown",
		});
	});

	/** @scenario "The media listener refuses an unknown or expired nonce" */
	it("rejects an expired nonce with 403", () => {
		let now = 0;
		const registry = new VoiceNonceRegistry({ ttlMs: 10, now: () => now });
		registry.register({ nonce: "abc", child: fakeChild });
		now = 10;
		expect(routeVoiceUpgrade({ url: "/twilio/abc", registry })).toEqual({
			action: "reject",
			status: 403,
			reason: "nonce expired",
		});
	});

	it("hands off a valid nonce to its child", () => {
		const registry = new VoiceNonceRegistry({ now: () => 0 });
		registry.register({ nonce: "abc", child: fakeChild });
		expect(routeVoiceUpgrade({ url: "/twilio/abc", registry })).toEqual({
			action: "handoff",
			nonce: "abc",
			child: fakeChild,
		});
	});
});

describe("bootVoiceWsListener", () => {
	let listener: Awaited<ReturnType<typeof bootVoiceWsListener>> | undefined;
	let registry: VoiceNonceRegistry;

	beforeEach(() => {
		registry = new VoiceNonceRegistry();
	});

	afterEach(async () => {
		await listener?.close();
		listener = undefined;
	});

	async function boot(): Promise<number> {
		listener = await bootVoiceWsListener({
			port: 0,
			publicBaseUrl: "https://voice.example.com",
			registry,
			logger: silentLogger,
		});
		return (listener.address as AddressInfo).port;
	}

	function get(port: number, path: string): Promise<{ status: number }> {
		return new Promise((resolve, reject) => {
			const req = http.get({ host: "127.0.0.1", port, path }, (res) => {
				res.resume();
				res.on("end", () => resolve({ status: res.statusCode ?? 0 }));
			});
			req.on("error", reject);
		});
	}

	/** Send a raw upgrade request and resolve with the first response line. */
	function rawUpgrade(
		port: number,
		path: string,
	): Promise<{ statusLine: string; socket: net.Socket }> {
		return new Promise((resolve, reject) => {
			const socket = net.connect(port, "127.0.0.1", () => {
				socket.write(
					`GET ${path} HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`,
				);
			});
			socket.once("data", (chunk) => {
				resolve({
					statusLine: chunk.toString().split("\r\n")[0] ?? "",
					socket,
				});
			});
			socket.once("error", reject);
		});
	}

	/** @scenario "The media listener answers its health check and refuses everything else" */
	it("answers ok at the health path and not found elsewhere", async () => {
		const port = await boot();
		expect((await get(port, "/healthz")).status).toBe(200);
		expect((await get(port, "/anything-else")).status).toBe(404);
	});

	/** @scenario "The media listener refuses an upgrade on a non-media path" */
	it("closes an upgrade on a non-media path with 404", async () => {
		const port = await boot();
		const { statusLine, socket } = await rawUpgrade(port, "/not-twilio");
		expect(statusLine).toContain("404");
		socket.destroy();
	});

	/** @scenario "The media listener refuses an unknown or expired nonce" */
	it("closes an upgrade with an unknown nonce with 403", async () => {
		const port = await boot();
		const { statusLine, socket } = await rawUpgrade(port, "/twilio/unknown");
		expect(statusLine).toContain("403");
		socket.destroy();
	});

	/** @scenario "The media listener hands a valid call's socket to its scenario child" */
	it("hands the raw socket to the registered child on a valid nonce", async () => {
		const port = await boot();
		const send = vi.fn(
			(_msg: unknown, _handle: unknown, cb: (e: Error | null) => void) => {
				cb(null);
				return true;
			},
		);
		const child = { send } as unknown as ChildProcess;
		registry.register({ nonce: "good", child });

		const client = net.connect(port, "127.0.0.1", () => {
			client.write(
				`GET /twilio/good HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`,
			);
		});

		await vi.waitFor(() => {
			expect(send).toHaveBeenCalledTimes(1);
		});
		const [, handle] = send.mock.calls[0] ?? [];
		expect(handle).toBeInstanceOf(net.Socket);
		// The fake child never received a real handle, so destroy the parent-side
		// socket here rather than leak it into afterEach.
		(handle as net.Socket).destroy();
		client.destroy();
	});
});

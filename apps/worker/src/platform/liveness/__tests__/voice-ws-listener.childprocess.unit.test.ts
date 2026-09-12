/**
 * The parent -> child socket handoff, end to end through a real OS child
 * process with an inter-process channel. This is the one test that exercises
 * `ChildProcess.send(message, socket)` for real: the listener accepts a raw
 * upgrade and the socket, with the bytes read during the upgrade, arrives in a
 * separate process.
 *
 * @see specs/features/agents/voice-phone.feature
 */

import { type ChildProcess, spawn } from "node:child_process";
import type { AddressInfo } from "node:net";
import net from "node:net";
import type { Logger } from "@langwatch/observability";
import { afterEach, describe, expect, it } from "vitest";
import { VoiceNonceRegistry } from "../../scenarios/voice/voice-nonce-registry";
import { bootVoiceWsListener } from "../voice-ws-listener";

const silentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
} as unknown as Logger;

// A minimal child that installs the receiver shape by hand (the real receiver
// lives in TS the child cannot import), reads the head, and reports back.
const CHILD_SOURCE = `
process.on("message", (msg, handle) => {
  if (msg && msg.type === "voice:twilio-media-socket" && handle) {
    const head = Buffer.from(msg.headBase64, "base64").toString();
    process.send({ received: true, nonce: msg.nonce, head });
    try { handle.destroy(); } catch (e) {}
  }
});
process.send({ ready: true });
`;

describe("voice media socket handoff to a real child process", () => {
  let child: ChildProcess | undefined;
  let listener: Awaited<ReturnType<typeof bootVoiceWsListener>> | undefined;

  afterEach(async () => {
    await listener?.close();
    listener = undefined;
    child?.kill();
    child = undefined;
  });

  /** @scenario "A handed-off media socket arrives at the scenario child process" */
  it("delivers the socket handle and the upgrade head bytes to the child", async () => {
    child = spawn(process.execPath, ["-e", CHILD_SOURCE], {
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    const theChild = child;

    await new Promise<void>((resolve, reject) => {
      theChild.once("error", reject);
      theChild.on("message", (msg: { ready?: boolean }) => {
        if (msg.ready) resolve();
      });
    });

    const registry = new VoiceNonceRegistry();
    listener = await bootVoiceWsListener({
      port: 0,
      publicBaseUrl: "https://voice.example.com",
      registry,
      logger: silentLogger,
    });
    const port = (listener.address as AddressInfo).port;
    registry.register({ nonce: "handoff", child: theChild });

    const received = new Promise<{ nonce: string; head: string }>((resolve) => {
      theChild.on(
        "message",
        (msg: { received?: boolean; nonce: string; head: string }) => {
          if (msg.received) resolve({ nonce: msg.nonce, head: msg.head });
        },
      );
    });

    // Write the upgrade request plus extra bytes after the header block, so
    // the head buffer the child must receive is non-empty.
    const client = net.connect(port, "127.0.0.1", () => {
      client.write(
        `GET /twilio/handoff HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\nHELLO`,
      );
    });

    const result = await received;
    expect(result.nonce).toBe("handoff");
    expect(result.head).toBe("HELLO");
    client.destroy();
  });
});

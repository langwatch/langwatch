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

/**
 * Wait for one IPC message matching `matches`, but also reject on an early
 * `exit` or `error` so a dead child hangs the wait until the Vitest timeout
 * instead of failing loud. Removes every listener it attached once settled.
 */
function waitForChildMessage<T>(
  child: ChildProcess,
  matches: (message: T) => boolean,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onMessage = (message: T): void => {
      if (matches(message)) {
        cleanup();
        resolve(message);
      }
    };
    const onExit = (code: number | null, signal: string | null): void => {
      cleanup();
      reject(
        new Error(
          `child exited before sending the expected message (code=${code}, signal=${signal})`,
        ),
      );
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const cleanup = (): void => {
      child.off("message", onMessage);
      child.off("exit", onExit);
      child.off("error", onError);
    };
    child.on("message", onMessage);
    child.on("exit", onExit);
    child.on("error", onError);
  });
}

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

    await waitForChildMessage<{ ready?: boolean }>(
      theChild,
      (msg) => !!msg.ready,
    );

    const registry = new VoiceNonceRegistry();
    listener = await bootVoiceWsListener({
      port: 0,
      publicBaseUrl: "https://voice.example.com",
      registry,
      logger: silentLogger,
    });
    const port = (listener.address as AddressInfo).port;
    registry.register({ nonce: "handoff", child: theChild });

    const received = waitForChildMessage<{
      received?: boolean;
      nonce: string;
      head: string;
    }>(theChild, (msg) => !!msg.received);

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

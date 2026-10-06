/**
 * The media door hands a real upgrade socket to a real child process over its IPC channel.
 * @see specs/features/agents/voice-phone.feature
 */
import { type ChildProcess, spawn } from "node:child_process";
import { createServer, connect, type Server, type Socket } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { MemoryVoiceNonceRepository } from "../../repositories/memory/memory.voice-nonce.repository.ts";
import { VoiceMediaDoorService } from "../voice-media-door.service.ts";
import { VoiceNonceRegistryService } from "../voice-nonce-registry.service.ts";

/** The child answers its parent with what arrived and speaks on the handed-off socket. */
const CHILD_SCRIPT = `
process.on("message", (message, handle) => {
  const isSocket = Boolean(handle) && typeof handle.write === "function";
  process.send({ nonce: message.nonce, head: message.headBase64, isSocket });
  if (isSocket) handle.end("child-owns-this-socket");
});
process.send({ ready: true });
`;

function waitForMessage(
  child: ChildProcess,
  accept: (message: unknown) => boolean,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    const listener = (message: unknown) => {
      if (!accept(message)) return;
      child.off("message", listener);
      resolve(message);
    };
    child.on("message", listener);
  });
}

function readAll(socket: Socket): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.on("end", () => resolve(Buffer.concat(chunks).toString()));
    socket.on("error", reject);
  });
}

describe("VoiceMediaDoorService with a real scenario child process", () => {
  const cleanup: (() => void)[] = [];

  afterEach(() => {
    for (const close of cleanup.splice(0)) close();
  });

  describe("given a real child with an IPC channel and a nonce registered to it", () => {
    /** @scenario "A handed-off media socket arrives at the scenario child process" */
    it("delivers the live socket handle and the bytes read during the upgrade", async () => {
      const child = spawn(process.execPath, ["-e", CHILD_SCRIPT], {
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      });
      cleanup.push(() => child.kill());
      await waitForMessage(child, (message) => (message as { ready?: boolean })?.ready === true);

      const nonces = VoiceNonceRegistryService.create({
        nonces: MemoryVoiceNonceRepository.create({}),
        ttlMs: 60_000,
      });
      await nonces.register({ nonce: "nonce-real", child });
      const door = VoiceMediaDoorService.create({ nonces });

      const server: Server = createServer((upgradeSocket) => {
        door.accept({
          nonce: "nonce-real",
          url: "/twilio/nonce-real",
          method: "GET",
          headers: { upgrade: "websocket" },
          head: Buffer.from("bytes-read-during-upgrade"),
          socket: upgradeSocket,
        });
      });
      cleanup.push(() => server.close());
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("no port bound");

      const twilio = connect({ port: address.port, host: "127.0.0.1" });
      cleanup.push(() => twilio.destroy());
      const arrived = waitForMessage(
        child,
        (message) => (message as { nonce?: string })?.nonce === "nonce-real",
      );
      const spoken = readAll(twilio);

      await expect(arrived).resolves.toEqual({
        nonce: "nonce-real",
        head: Buffer.from("bytes-read-during-upgrade").toString("base64"),
        isSocket: true,
      });
      await expect(spoken).resolves.toBe("child-owns-this-socket");
    });
  });
});

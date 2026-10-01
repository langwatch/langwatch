/**
 * @see specs/features/agents/voice-phone.feature
 */
import { ChildProcess } from "node:child_process";
import { Socket } from "node:net";

import { VOICE_MEDIA_UPGRADE_REFUSED_MESSAGE } from "@langwatch/scenario-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryVoiceNonceRepository } from "../../repositories/memory/memory.voice-nonce.repository.ts";
import { VoiceMediaDoorService } from "../voice-media-door.service.ts";
import { VoiceNonceRegistryService } from "../voice-nonce-registry.service.ts";

/** A spawned child as the door reaches it: the IPC send it hands the socket through. */
function fakeChild(): { child: ChildProcess; send: ReturnType<typeof vi.fn> } {
  const send = vi.fn(
    (_message: unknown, _handle?: unknown, callback?: (error: Error | null) => void) => {
      callback?.(null);
      return true;
    },
  );
  const child = Object.assign(new ChildProcess(), { send });
  return { child, send };
}

function upgradeFor({ nonce, socket }: { nonce: string; socket: Socket }) {
  return {
    nonce,
    url: `/twilio/${nonce}`,
    method: "GET",
    headers: { upgrade: "websocket" },
    head: new Uint8Array(),
    socket,
  };
}

/** A socket whose 403 is recorded rather than written. */
function refusableSocket(): { socket: Socket; end: ReturnType<typeof vi.spyOn> } {
  const socket = new Socket();
  const end = vi.spyOn(socket, "end").mockImplementation(() => socket);
  return { socket, end };
}

function registryOn(clock: { now: number }): VoiceNonceRegistryService {
  const now = () => clock.now;
  return VoiceNonceRegistryService.create({
    nonces: MemoryVoiceNonceRepository.create({ now }),
    ttlMs: 100,
    now,
  });
}

describe("VoiceMediaDoorService", () => {
  describe("given the child registered its nonce with the parent", () => {
    let nonces: VoiceNonceRegistryService;
    let send: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      nonces = registryOn({ now: 0 });
      const registered = fakeChild();
      send = registered.send;
      await nonces.register({ nonce: "n1", child: registered.child });
    });

    /** @scenario "A registered nonce lets the real Twilio upgrade through" */
    it("hands the upgrade socket to that child instead of refusing it", async () => {
      const socket = new Socket();
      const end = vi.spyOn(socket, "end");

      VoiceMediaDoorService.create({ nonces }).accept(upgradeFor({ nonce: "n1", socket }));

      await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
      expect(send.mock.calls[0]?.[1]).toBe(socket);
      expect(end).not.toHaveBeenCalled();
    });

    /** @scenario "The media listener hands a valid call's socket to its scenario child" */
    it("sends the child the upgrade it needs to finish the handshake", async () => {
      VoiceMediaDoorService.create({ nonces }).accept(
        upgradeFor({ nonce: "n1", socket: new Socket() }),
      );

      await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
      expect(send.mock.calls[0]?.[0]).toMatchObject({ nonce: "n1", url: "/twilio/n1" });
    });

    it("refuses a second upgrade on the same nonce as unknown", async () => {
      const door = VoiceMediaDoorService.create({ nonces });
      door.accept(upgradeFor({ nonce: "n1", socket: new Socket() }));
      await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
      const replay = refusableSocket();

      door.accept(upgradeFor({ nonce: "n1", socket: replay.socket }));

      await vi.waitFor(() =>
        expect(replay.end).toHaveBeenCalledWith(expect.stringContaining("403")),
      );
      expect(send).toHaveBeenCalledTimes(1);
    });
  });

  describe("given the child never registered its nonce", () => {
    /** @scenario "An unregistered nonce is refused 403" */
    it("closes the socket 403 as an unknown nonce", async () => {
      const { socket, end } = refusableSocket();

      VoiceMediaDoorService.create({ nonces: registryOn({ now: 0 }) }).accept(
        upgradeFor({ nonce: "stray", socket }),
      );

      await vi.waitFor(() => expect(end).toHaveBeenCalledWith(expect.stringContaining("403")));
    });
  });

  describe("given the nonce expired before the dial-back", () => {
    it("closes the socket 403 and tells the child why", async () => {
      const clock = { now: 0 };
      const nonces = registryOn(clock);
      const { child, send } = fakeChild();
      await nonces.register({ nonce: "n1", child });
      clock.now = 100;
      const { socket, end } = refusableSocket();

      VoiceMediaDoorService.create({ nonces }).accept(upgradeFor({ nonce: "n1", socket }));

      await vi.waitFor(() => expect(end).toHaveBeenCalledWith(expect.stringContaining("403")));
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: VOICE_MEDIA_UPGRADE_REFUSED_MESSAGE,
          reason: "nonce expired",
        }),
      );
    });
  });
});

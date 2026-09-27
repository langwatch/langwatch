/**
 * @see specs/features/agents/voice-phone.feature
 */
import { ChildProcess } from "node:child_process";
import { Socket } from "node:net";

import { describe, expect, it, vi } from "vitest";

import { VoiceMediaDoorService } from "../voice-media-door.service.ts";
import { VoiceNonceRegistryService } from "../voice-nonce-registry.service.ts";

/** A spawned child as the door reaches it: the IPC send it hands the socket through. */
function fakeChild(): { child: ChildProcess; send: ReturnType<typeof vi.fn> } {
  const send = vi.fn(
    (_message: unknown, _handle: unknown, callback?: (error: Error | null) => void) => {
      callback?.(null);
      return true;
    },
  );
  const child = Object.assign(new ChildProcess(), { send });
  return { child, send };
}

function upgradeFor(nonce: string, socket: Socket) {
  return {
    nonce,
    url: `/twilio/${nonce}`,
    method: "GET",
    headers: { upgrade: "websocket" },
    head: new Uint8Array(),
    socket,
  };
}

describe("VoiceMediaDoorService", () => {
  describe("given the child registered its nonce with the parent", () => {
    /** @scenario "A registered nonce lets the real Twilio upgrade through" */
    it("hands the upgrade socket to that child instead of refusing it", async () => {
      const nonces = VoiceNonceRegistryService.create();
      const { child, send } = fakeChild();
      nonces.register({ nonce: "n1", child });
      const socket = new Socket();
      const end = vi.spyOn(socket, "end");

      VoiceMediaDoorService.create({ nonces }).accept(upgradeFor("n1", socket));

      await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
      expect(send.mock.calls[0]?.[1]).toBe(socket);
      expect(end).not.toHaveBeenCalled();
    });
  });

  describe("given the child never registered its nonce", () => {
    /** @scenario "An unregistered nonce is refused 403" */
    it("closes the socket 403 as an unknown nonce", () => {
      const socket = new Socket();
      const end = vi.spyOn(socket, "end").mockImplementation(() => socket);

      VoiceMediaDoorService.create({ nonces: VoiceNonceRegistryService.create() }).accept(
        upgradeFor("stray", socket),
      );

      expect(end).toHaveBeenCalledWith(expect.stringContaining("403 Forbidden"));
    });
  });
});

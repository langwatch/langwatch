/**
 * @see specs/features/agents/voice-phone.feature
 */
import { ChildProcess } from "node:child_process";
import { createHmac } from "node:crypto";
import { Socket } from "node:net";

import { VOICE_MEDIA_UPGRADE_REFUSED_MESSAGE } from "@langwatch/scenario-contract";
import { describe, expect, it, vi } from "vitest";

import { MemoryVoiceNonceRepository } from "../../repositories/memory/memory.voice-nonce.repository.ts";
import { VoiceMediaDoorService } from "../voice-media-door.service.ts";
import { VoiceNonceRegistryService } from "../voice-nonce-registry.service.ts";
import type { VoicePublicUrl } from "../voice-public-url.service.ts";

const AUTH_TOKEN = "twilio-auth-token";
const PUBLIC_URL: VoicePublicUrl = { url: "https://media.example.com" };

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

function signatureFor({
  nonce,
  authToken = AUTH_TOKEN,
  host = "media.example.com",
}: {
  nonce: string;
  authToken?: string;
  host?: string;
}): string {
  return createHmac("sha1", authToken).update(`wss://${host}/twilio/${nonce}`).digest("base64");
}

function upgradeFor({
  nonce,
  socket,
  signature,
}: {
  nonce: string;
  socket: Socket;
  signature?: string;
}) {
  return {
    nonce,
    url: `/twilio/${nonce}`,
    method: "GET",
    headers: signature
      ? { upgrade: "websocket", "x-twilio-signature": signature }
      : { upgrade: "websocket" },
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

async function doorWithRegistered({ publicUrl = PUBLIC_URL }: { publicUrl?: VoicePublicUrl } = {}) {
  const nonces = VoiceNonceRegistryService.create({ nonces: MemoryVoiceNonceRepository.create() });
  const { child, send } = fakeChild();
  await nonces.register({ nonce: "n1", child, authToken: AUTH_TOKEN });
  return { door: VoiceMediaDoorService.create({ nonces, publicUrl }), send };
}

const refusalNotice = expect.objectContaining({ type: VOICE_MEDIA_UPGRADE_REFUSED_MESSAGE });

describe("VoiceMediaDoorService", () => {
  describe("given the child registered its nonce and Twilio signed the upgrade", () => {
    /** @scenario "A registered nonce lets the real Twilio upgrade through" */
    it("hands the upgrade socket to that child instead of refusing it", async () => {
      const { door, send } = await doorWithRegistered();
      const socket = new Socket();
      const end = vi.spyOn(socket, "end");

      door.accept(upgradeFor({ nonce: "n1", socket, signature: signatureFor({ nonce: "n1" }) }));

      await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
      expect(send.mock.calls[0]?.[1]).toBe(socket);
      expect(end).not.toHaveBeenCalled();
    });

    /** @scenario "A media upgrade signed by Twilio for its stream URL is handed to the child" */
    it("verifies the signature against the stream URL the child was given", async () => {
      const { door, send } = await doorWithRegistered({
        publicUrl: { url: "https://media.example.com/" },
      });
      const socket = new Socket();

      door.accept(upgradeFor({ nonce: "n1", socket, signature: signatureFor({ nonce: "n1" }) }));

      await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
      expect(send.mock.calls[0]?.[0]).toMatchObject({ nonce: "n1", url: "/twilio/n1" });
    });
  });

  describe("given the child never registered its nonce", () => {
    /** @scenario "An unregistered nonce is refused 403" */
    it("closes the socket 403 as an unknown nonce", async () => {
      const { socket, end } = refusableSocket();
      const door = VoiceMediaDoorService.create({
        nonces: VoiceNonceRegistryService.create({ nonces: MemoryVoiceNonceRepository.create() }),
        publicUrl: PUBLIC_URL,
      });

      door.accept(
        upgradeFor({ nonce: "stray", socket, signature: signatureFor({ nonce: "stray" }) }),
      );

      await vi.waitFor(() => expect(end).toHaveBeenCalledWith(expect.stringContaining("403")));
    });
  });

  describe("given an upgrade with no X-Twilio-Signature", () => {
    /** @scenario "A media upgrade without Twilio's signature is refused and its nonce is spent" */
    it("refuses it 403, tells the child, and a second upgrade reads unknown", async () => {
      const { door, send } = await doorWithRegistered();
      const first = refusableSocket();

      door.accept(upgradeFor({ nonce: "n1", socket: first.socket }));

      await vi.waitFor(() =>
        expect(first.end).toHaveBeenCalledWith(expect.stringContaining("403")),
      );
      expect(send).toHaveBeenCalledWith(refusalNotice);

      const second = refusableSocket();
      door.accept(
        upgradeFor({
          nonce: "n1",
          socket: second.socket,
          signature: signatureFor({ nonce: "n1" }),
        }),
      );

      await vi.waitFor(() =>
        expect(second.end).toHaveBeenCalledWith(expect.stringContaining("403")),
      );
      expect(send).toHaveBeenCalledTimes(1);
    });
  });

  describe("given an upgrade signed with another account's token", () => {
    /** @scenario "A media upgrade signed with another account's token is refused" */
    it("refuses it 403 and never hands the socket over", async () => {
      const { door, send } = await doorWithRegistered();
      const { socket, end } = refusableSocket();

      door.accept(
        upgradeFor({
          nonce: "n1",
          socket,
          signature: signatureFor({ nonce: "n1", authToken: "other" }),
        }),
      );

      await vi.waitFor(() => expect(end).toHaveBeenCalledWith(expect.stringContaining("403")));
      expect(send).toHaveBeenCalledWith(refusalNotice);
      expect(send).toHaveBeenCalledTimes(1);
    });
  });

  describe("given an upgrade signed for a stream URL on another host", () => {
    /** @scenario "A media upgrade signed for another URL is refused" */
    it("refuses it 403", async () => {
      const { door } = await doorWithRegistered();
      const { socket, end } = refusableSocket();

      door.accept(
        upgradeFor({
          nonce: "n1",
          socket,
          signature: signatureFor({ nonce: "n1", host: "evil.example.com" }),
        }),
      );

      await vi.waitFor(() => expect(end).toHaveBeenCalledWith(expect.stringContaining("403")));
    });
  });

  describe("given a worker whose public media URL is unavailable", () => {
    /** @scenario "A worker without a public media URL refuses every media upgrade" */
    it("refuses a registered nonce's upgrade 403", async () => {
      const { door, send } = await doorWithRegistered({ publicUrl: { unavailable: "no tunnel" } });
      const { socket, end } = refusableSocket();

      door.accept(upgradeFor({ nonce: "n1", socket, signature: signatureFor({ nonce: "n1" }) }));

      await vi.waitFor(() => expect(end).toHaveBeenCalledWith(expect.stringContaining("403")));
      expect(send).toHaveBeenCalledWith(refusalNotice);
    });
  });
});

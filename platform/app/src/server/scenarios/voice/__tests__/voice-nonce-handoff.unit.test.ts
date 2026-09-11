/**
 * @see specs/features/agents/voice-phone.feature
 */

import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  handleVoiceNonceRegisterMessage,
  isVoiceMediaUpgradeRefusedMessage,
  isVoiceNonceRegisterAckMessage,
  isVoiceNonceRegisterMessage,
  raceAgainstUpgradeRefusal,
  requestNonceRegistration,
  VOICE_MEDIA_UPGRADE_REFUSED_MESSAGE,
  VOICE_NONCE_REGISTER_ACK_MESSAGE,
  VOICE_NONCE_REGISTER_MESSAGE,
  VoiceMediaUpgradeRefusedError,
  type VoiceNonceRegisterAckMessage,
  type VoiceNonceRegisterMessage,
  VoiceNonceRegistrationFailedError,
  VoiceNonceRegistrationNoChannelError,
  VoiceNonceRegistrationTimeoutError,
} from "../voice-nonce-handoff";
import { VoiceNonceRegistry } from "../voice-nonce-registry";

describe("isVoiceNonceRegisterMessage", () => {
  it("matches only the registration request", () => {
    const msg: VoiceNonceRegisterMessage = {
      type: VOICE_NONCE_REGISTER_MESSAGE,
      requestId: "r1",
      nonce: "n1",
    };
    expect(isVoiceNonceRegisterMessage(msg)).toBe(true);
    expect(isVoiceNonceRegisterMessage({ type: "something-else" })).toBe(false);
    expect(isVoiceNonceRegisterMessage(null)).toBe(false);
  });
});

describe("isVoiceNonceRegisterAckMessage", () => {
  it("matches only the ack", () => {
    const ack: VoiceNonceRegisterAckMessage = {
      type: VOICE_NONCE_REGISTER_ACK_MESSAGE,
      requestId: "r1",
      ok: true,
    };
    expect(isVoiceNonceRegisterAckMessage(ack)).toBe(true);
    expect(isVoiceNonceRegisterAckMessage({ type: "something-else" })).toBe(
      false,
    );
  });
});

/** A fake process-like object driving both directions of the IPC exchange
 *  without a real child process, mirroring voice-socket-handoff.unit.test.ts's
 *  EventEmitter fake. */
function fakeIpcProcess() {
  const emitter = new EventEmitter();
  const sent: unknown[] = [];
  return {
    sent,
    proc: {
      send: vi.fn((message: unknown, cb?: (error: Error | null) => void) => {
        sent.push(message);
        cb?.(null);
        return true;
      }),
      on: (event: "message", listener: (message: unknown) => void) =>
        emitter.on(event, listener),
      off: (event: "message", listener: (message: unknown) => void) =>
        emitter.off(event, listener),
    },
    emitMessage: (message: unknown) => emitter.emit("message", message),
  };
}

describe("requestNonceRegistration", () => {
  describe("given a parent that acks ok", () => {
    it("resolves once the ack for THIS request arrives", async () => {
      const { proc, sent, emitMessage } = fakeIpcProcess();
      const promise = requestNonceRegistration({
        nonce: "n1",
        proc,
        requestId: "req-1",
      });

      const sentMessage = sent[0] as VoiceNonceRegisterMessage;
      expect(sentMessage).toMatchObject({
        type: VOICE_NONCE_REGISTER_MESSAGE,
        requestId: "req-1",
        nonce: "n1",
      });

      // A stray ack for a different request must not resolve this call.
      emitMessage({
        type: VOICE_NONCE_REGISTER_ACK_MESSAGE,
        requestId: "some-other-request",
        ok: true,
      });
      emitMessage({
        type: VOICE_NONCE_REGISTER_ACK_MESSAGE,
        requestId: "req-1",
        ok: true,
      });

      await expect(promise).resolves.toBeUndefined();
    });
  });

  describe("given a parent that acks with a failure", () => {
    it("rejects with the parent's reason", async () => {
      const { proc, emitMessage } = fakeIpcProcess();
      const promise = requestNonceRegistration({
        nonce: "n1",
        proc,
        requestId: "req-1",
      });
      emitMessage({
        type: VOICE_NONCE_REGISTER_ACK_MESSAGE,
        requestId: "req-1",
        ok: false,
        error: "no voice listener booted in this process",
      });
      await expect(promise).rejects.toBeInstanceOf(
        VoiceNonceRegistrationFailedError,
      );
      await expect(promise).rejects.toThrow(
        "no voice listener booted in this process",
      );
    });
  });

  describe("given a parent that never acks", () => {
    it("rejects with a timeout once timeoutMs elapses", async () => {
      const { proc } = fakeIpcProcess();
      await expect(
        requestNonceRegistration({ nonce: "n1", proc, timeoutMs: 20 }),
      ).rejects.toBeInstanceOf(VoiceNonceRegistrationTimeoutError);
    });
  });

  describe("given the process has no IPC channel", () => {
    it("rejects immediately without waiting", async () => {
      const proc = {
        on: () => {},
        off: () => {},
      };
      await expect(
        requestNonceRegistration({ nonce: "n1", proc }),
      ).rejects.toBeInstanceOf(VoiceNonceRegistrationNoChannelError);
    });
  });
});

describe("handleVoiceNonceRegisterMessage", () => {
  describe("given a registry that accepts the registration", () => {
    it("registers the nonce against the sending child and acks ok", () => {
      const registry = new VoiceNonceRegistry();
      const child = {} as ChildProcess;
      const ack = handleVoiceNonceRegisterMessage({
        message: {
          type: VOICE_NONCE_REGISTER_MESSAGE,
          requestId: "req-1",
          nonce: "n1",
        },
        child,
        registry,
      });

      expect(ack).toEqual({
        type: VOICE_NONCE_REGISTER_ACK_MESSAGE,
        requestId: "req-1",
        ok: true,
      });
      // The registration is real, not merely reported: a subsequent consume
      // resolves to the exact child that registered it (AC from the brief:
      // "the parent registers the nonce such that a subsequent consume(nonce)
      // on the real registry returns the child").
      expect(registry.consume("n1")).toEqual({ ok: true, child });
    });
  });

  describe("given a registry that throws", () => {
    it("acks with ok:false and the thrown reason, without letting the error propagate", () => {
      const registry = {
        register: vi.fn(() => {
          throw new Error("registry exploded");
        }),
      };
      const child = {} as ChildProcess;
      const ack = handleVoiceNonceRegisterMessage({
        message: {
          type: VOICE_NONCE_REGISTER_MESSAGE,
          requestId: "req-1",
          nonce: "n1",
        },
        child,
        registry,
      });

      expect(ack).toEqual({
        type: VOICE_NONCE_REGISTER_ACK_MESSAGE,
        requestId: "req-1",
        ok: false,
        error: "registry exploded",
      });
    });
  });
});

describe("isVoiceMediaUpgradeRefusedMessage", () => {
  it("matches only the refusal notice", () => {
    expect(
      isVoiceMediaUpgradeRefusedMessage({
        type: VOICE_MEDIA_UPGRADE_REFUSED_MESSAGE,
        reason: "nonce expired",
      }),
    ).toBe(true);
    expect(isVoiceMediaUpgradeRefusedMessage({ type: "something-else" })).toBe(
      false,
    );
    expect(isVoiceMediaUpgradeRefusedMessage(null)).toBe(false);
  });
});

describe("raceAgainstUpgradeRefusal", () => {
  describe("given no refusal ever arrives", () => {
    it("resolves with the promise's own outcome", async () => {
      const { proc } = fakeIpcProcess();
      await expect(
        raceAgainstUpgradeRefusal(Promise.resolve("dialled"), proc),
      ).resolves.toBe("dialled");
    });
  });

  describe("given a refusal notice arrives before the promise settles", () => {
    /**
     * The point of this function: a promise that would otherwise stay
     * pending until its own (much longer) timeout instead fails FAST, with
     * the real cause, the moment the parent's refusal notice arrives.
     * @scenario "A phone call fails fast when the listener refuses the socket mid-dial"
     */
    it("rejects with the refusal reason instead of waiting on the promise", async () => {
      const { proc, emitMessage } = fakeIpcProcess();
      const neverSettles = new Promise<string>(() => {});
      const raced = raceAgainstUpgradeRefusal(neverSettles, proc);

      emitMessage({
        type: VOICE_MEDIA_UPGRADE_REFUSED_MESSAGE,
        reason: "nonce expired",
      });

      await expect(raced).rejects.toBeInstanceOf(VoiceMediaUpgradeRefusedError);
      await expect(raced).rejects.toThrow(/nonce expired/);
    });
  });

  describe("given the promise settles before any refusal", () => {
    it("unsubscribes its listener so a later, unrelated refusal notice is inert", async () => {
      const { proc, emitMessage } = fakeIpcProcess();
      await raceAgainstUpgradeRefusal(Promise.resolve("dialled"), proc);

      // A stray/late refusal notice after the race already settled must not
      // throw an unhandled rejection or otherwise misbehave — the listener
      // should already be gone.
      expect(() =>
        emitMessage({
          type: VOICE_MEDIA_UPGRADE_REFUSED_MESSAGE,
          reason: "nonce expired",
        }),
      ).not.toThrow();
    });
  });

  describe("given an unrelated IPC message arrives", () => {
    it("ignores it and keeps waiting on the promise", async () => {
      const { proc, emitMessage } = fakeIpcProcess();
      const raced = raceAgainstUpgradeRefusal(Promise.resolve("dialled"), proc);
      emitMessage({ type: "something-else" });
      await expect(raced).resolves.toBe("dialled");
    });
  });
});

/**
 * End-to-end (within one process) proof that closing the nonce-registration
 * gap actually closes it: a child's registration request, handled the exact
 * way scenario.processor.ts handles it, makes the real media listener accept
 * the matching Twilio upgrade instead of refusing it 403.
 *
 * This is deliberately NOT a mock of either half. It drives the real
 * `VoiceNonceRegistry`, the real `handleVoiceNonceRegisterMessage` (the
 * parent's IPC message handler), and the real `routeVoiceUpgrade` (the
 * listener's upgrade decision) — the same three things that must agree in
 * production for a Twilio call to connect.
 *
 * @see specs/features/agents/voice-phone.feature
 */

import type { ChildProcess } from "node:child_process";
import { describe, expect, it } from "vitest";
import { routeVoiceUpgrade } from "../../../workers/voice-ws-listener";
import {
  handleVoiceNonceRegisterMessage,
  VOICE_NONCE_REGISTER_MESSAGE,
} from "../voice-nonce-handoff";
import { VoiceNonceRegistry } from "../voice-nonce-registry";

describe("nonce registration -> listener upgrade, end to end in one process", () => {
  describe("given the child registered its nonce with the parent", () => {
    /**
     * This is the production gap closed by this change: before it, nothing
     * ever called `registry.register`, so this exact sequence 403'd every
     * real call (confirmed live: Twilio error 31920).
     */
    /** @scenario "A registered nonce lets the real Twilio upgrade through" */
    it("routes the matching Twilio upgrade to a handoff, not a 403", () => {
      const registry = new VoiceNonceRegistry();
      const child = {} as ChildProcess;

      // The parent's side of the handshake, exactly as scenario.processor.ts
      // invokes it from a real child.on("message", ...) handler.
      const ack = handleVoiceNonceRegisterMessage({
        message: {
          type: VOICE_NONCE_REGISTER_MESSAGE,
          requestId: "req-1",
          nonce: "e2e-nonce",
        },
        child,
        registry,
      });
      expect(ack.ok).toBe(true);

      // Twilio's dial-back, as the real listener decides it.
      const decision = routeVoiceUpgrade({
        url: "/twilio/e2e-nonce",
        registry,
      });

      expect(decision).toEqual({
        action: "handoff",
        nonce: "e2e-nonce",
        child,
      });
    });
  });

  describe("given the child never registered its nonce", () => {
    /**
     * MANDATORY TEETH CHECK companion: this is the same request routed
     * through a registry nothing ever wrote to — the exact pre-fix state
     * (nothing ever called registry.register in production). Confirms the
     * refusal shape the fix eliminates.
     */
    /** @scenario "An unregistered nonce is refused 403" */
    it("refuses the upgrade as an unknown nonce", () => {
      const registry = new VoiceNonceRegistry();

      const decision = routeVoiceUpgrade({
        url: "/twilio/never-registered",
        registry,
      });

      expect(decision).toEqual({
        action: "reject",
        status: 403,
        reason: "nonce unknown",
      });
    });
  });
});

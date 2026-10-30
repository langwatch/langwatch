import { describe, expect, it } from "vitest";

import { MemoryTwilioCallControlChannel } from "../../../../channels/memory/memory.twilio-call-control.channel.ts";
import { MemoryPendingVoiceCallRepository } from "../../../../repositories/memory/memory.pending-voice-call.repository.ts";
import { PENDING_VOICE_CALL_TTL_SECONDS } from "../../../../repositories/pending-voice-call.repository.ts";
import { VoiceCallDialService } from "../voice-call-dial.service.ts";

const DIAL = { projectId: "project-1", scenarioRunId: "run-1", nonce: "nonce-1", to: "+15550100" };
const CALL = { nonce: "nonce-1", projectId: "project-1", scenarioRunId: "run-1" };

function setup(options: { whileDialling?: () => Promise<void> } = {}) {
  const clock = { now: 0 };
  const pending = MemoryPendingVoiceCallRepository.create({ now: () => clock.now });
  const callControl = MemoryTwilioCallControlChannel.create({
    onPlaceCall: async () => options.whileDialling?.(),
  });
  const service = VoiceCallDialService.create({ pending, callControl });
  return { clock, pending, callControl, service };
}

describe("VoiceCallDialService", () => {
  describe("given a run with no call yet", () => {
    it("stores the call, dials Twilio once and keeps the call SID", async () => {
      const { pending, callControl, service } = setup();

      const result = await service.dial(DIAL);

      expect(result).toEqual({ dialed: true, callSid: "CAnonce-1" });
      expect(callControl.placedCalls).toEqual([
        { projectId: "project-1", to: "+15550100", nonce: "nonce-1" },
      ]);
      await expect(pending.peek({ scenarioRunId: "run-1", nonce: "nonce-1" })).resolves.toEqual({
        found: true,
        call: CALL,
      });
      await expect(
        pending.cancel({ scenarioRunId: "run-1", tombstoneTtlSeconds: 60 }),
      ).resolves.toEqual({ state: "pending", callSid: "CAnonce-1" });
    });

    it("stores the call before it dials, so a pod can claim as soon as Twilio connects", async () => {
      const seen: unknown[] = [];
      const { pending, service } = setup({
        whileDialling: async () => {
          seen.push(await pending.peek({ scenarioRunId: "run-1", nonce: "nonce-1" }));
        },
      });

      await service.dial(DIAL);

      expect(seen).toEqual([{ found: true, call: CALL }]);
    });
  });

  describe("given a retry with the same nonce", () => {
    it("does not dial again while the call is pending", async () => {
      const { callControl, service } = setup();
      await service.dial(DIAL);

      const retry = await service.dial(DIAL);

      expect(retry).toEqual({ dialed: false, reason: "already-dialed" });
      expect(callControl.placedCalls).toHaveLength(1);
    });

    it("does not dial again once the call is claimed", async () => {
      const { pending, callControl, service } = setup();
      await service.dial(DIAL);
      await pending.claim({ scenarioRunId: "run-1", nonce: "nonce-1" });

      const retry = await service.dial(DIAL);

      expect(retry).toEqual({ dialed: false, reason: "already-dialed" });
      expect(callControl.placedCalls).toHaveLength(1);
    });
  });

  describe("given a run cancelled before the dial", () => {
    it("dials nothing and answers cancelled", async () => {
      const { pending, callControl, service } = setup();
      await pending.cancel({ scenarioRunId: "run-1", tombstoneTtlSeconds: 60 });

      const result = await service.dial(DIAL);

      expect(result).toEqual({ dialed: false, reason: "cancelled" });
      expect(callControl.placedCalls).toEqual([]);
    });
  });

  describe("given a run cancelled while Twilio is dialling", () => {
    it("ends the call it placed and answers cancelled", async () => {
      const { pending, callControl, service } = setup({
        whileDialling: async () => {
          await pending.cancel({ scenarioRunId: "run-1", tombstoneTtlSeconds: 60 });
        },
      });

      const result = await service.dial(DIAL);

      expect(result).toEqual({ dialed: false, reason: "cancelled" });
      expect(callControl.endedCalls).toEqual([{ projectId: "project-1", callSid: "CAnonce-1" }]);
    });
  });

  describe("given a pending call that lapses while Twilio is dialling", () => {
    it("ends the call it placed and answers expired", async () => {
      const { clock, callControl, service } = setup({
        whileDialling: async () => {
          clock.now += PENDING_VOICE_CALL_TTL_SECONDS * 1000;
        },
      });

      const result = await service.dial(DIAL);

      expect(result).toEqual({ dialed: false, reason: "expired" });
      expect(callControl.endedCalls).toEqual([{ projectId: "project-1", callSid: "CAnonce-1" }]);
    });
  });
});

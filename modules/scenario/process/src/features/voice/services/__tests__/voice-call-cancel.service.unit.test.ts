/**
 * @see specs/features/agents/voice-media-claim.feature
 */
import { describe, expect, it } from "vitest";

import { MemoryTwilioCallControlChannel } from "../../../../channels/memory/memory.twilio-call-control.channel.ts";
import { MemoryPendingVoiceCallRepository } from "../../../../repositories/memory/memory.pending-voice-call.repository.ts";
import { VoiceCallCancelService } from "../voice-call-cancel.service.ts";

const CALL = { nonce: "nonce-1", projectId: "project-1", scenarioRunId: "run-1" };

function setup() {
  const pending = MemoryPendingVoiceCallRepository.create();
  const callControl = MemoryTwilioCallControlChannel.create();
  const service = VoiceCallCancelService.create({ pending, callControl });
  return { pending, callControl, service };
}

describe("VoiceCallCancelService", () => {
  describe("given a pending call with a known call SID", () => {
    /** @scenario "A cancel before the claim ends the call when its SID is known" */
    it("ends the call at Twilio when cancelled", async () => {
      const { pending, callControl, service } = setup();
      await pending.put({ call: CALL, ttlSeconds: 60 });
      await pending.attachCallSid({ scenarioRunId: "run-1", callSid: "CA-1" });

      await service.cancel({ projectId: "project-1", scenarioRunId: "run-1" });

      expect(callControl.endedCalls).toEqual([{ projectId: "project-1", callSid: "CA-1" }]);
    });
  });

  describe("given a claimed call with a known call SID", () => {
    /** @scenario "A cancel after the claim ends the call" */
    it("ends the call at Twilio when cancelled", async () => {
      const { pending, callControl, service } = setup();
      await pending.put({ call: CALL, ttlSeconds: 60 });
      await pending.attachCallSid({ scenarioRunId: "run-1", callSid: "CA-2" });
      await pending.claim({ scenarioRunId: "run-1", nonce: "nonce-1" });

      await service.cancel({ projectId: "project-1", scenarioRunId: "run-1" });

      expect(callControl.endedCalls).toEqual([{ projectId: "project-1", callSid: "CA-2" }]);
    });
  });

  describe("given a run with no pending call", () => {
    /** @scenario "A cancel with no call to end ends nothing" */
    it("ends no call when cancelled", async () => {
      const { callControl, service } = setup();

      await service.cancel({ projectId: "project-1", scenarioRunId: "run-unknown" });

      expect(callControl.endedCalls).toEqual([]);
    });
  });

  describe("given a pending call whose SID is not known", () => {
    /** @scenario "A cancel before the call SID is known ends nothing yet" */
    it("ends no call when cancelled", async () => {
      const { pending, callControl, service } = setup();
      await pending.put({ call: CALL, ttlSeconds: 60 });

      await service.cancel({ projectId: "project-1", scenarioRunId: "run-1" });

      expect(callControl.endedCalls).toEqual([]);
    });

    it("answers cancelled when the SID is attached afterwards", async () => {
      const { pending, service } = setup();
      await pending.put({ call: CALL, ttlSeconds: 60 });
      await service.cancel({ projectId: "project-1", scenarioRunId: "run-1" });

      await expect(
        pending.attachCallSid({ scenarioRunId: "run-1", callSid: "CA-3" }),
      ).resolves.toEqual({ attached: false, reason: "cancelled" });
    });
  });
});

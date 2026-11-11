import { describe, expect, it } from "vitest";

import { MemoryTwilioCallControlChannel } from "../../../../channels/memory/memory.twilio-call-control.channel.ts";
import { MemoryPendingVoiceCallRepository } from "../../../../repositories/memory/memory.pending-voice-call.repository.ts";
import { VoiceCallCancelService } from "../voice-call-cancel.service.ts";
import { VoiceCallDialService } from "../voice-call-dial.service.ts";
import {
  VOICE_CALL_CLAIM_DEADLINE_SECONDS,
  expirePendingVoiceCallIfUnclaimed,
} from "../voice-call-expiry.service.ts";

const KEY = { scenarioRunId: "run-1", nonce: "nonce-1" };

async function dialled() {
  const clock = { now: 0 };
  const pending = MemoryPendingVoiceCallRepository.create({ now: () => clock.now });
  const callControl = MemoryTwilioCallControlChannel.create();
  const cancel = VoiceCallCancelService.create({ pending, callControl });
  await VoiceCallDialService.create({ pending, callControl }).dial({
    projectId: "project-1",
    ...KEY,
    to: "+15550100",
  });
  const expire = () =>
    expirePendingVoiceCallIfUnclaimed({ projectId: "project-1", ...KEY, pending, cancel });
  return { clock, pending, callControl, cancel, expire };
}

describe("expirePendingVoiceCallIfUnclaimed()", () => {
  describe("given a call no pod claimed by the deadline", () => {
    it("ends the call at Twilio and answers expired", async () => {
      const { clock, callControl, expire } = await dialled();
      clock.now = VOICE_CALL_CLAIM_DEADLINE_SECONDS * 1000;

      await expect(expire()).resolves.toBe("expired");
      expect(callControl.endedCalls).toEqual([{ projectId: "project-1", callSid: "CAnonce-1" }]);
    });

    it("refuses a pod that connects after it", async () => {
      const { clock, pending, expire } = await dialled();
      clock.now = VOICE_CALL_CLAIM_DEADLINE_SECONDS * 1000;
      await expire();

      await expect(pending.claim(KEY)).resolves.toEqual({ claimed: false, reason: "cancelled" });
    });
  });

  describe("given a call a pod claimed in time", () => {
    it("leaves the call up and answers already-claimed", async () => {
      const { clock, pending, callControl, expire } = await dialled();
      await pending.claim(KEY);
      clock.now = VOICE_CALL_CLAIM_DEADLINE_SECONDS * 1000;

      await expect(expire()).resolves.toBe("already-claimed");
      expect(callControl.endedCalls).toEqual([]);
      await expect(
        pending.put({
          call: { nonce: "nonce-1", projectId: "project-1", scenarioRunId: "run-1" },
          ttlSeconds: 60,
        }),
      ).resolves.toEqual({ stored: false, reason: "claimed" });
    });
  });

  describe("given a run already cancelled", () => {
    it("ends nothing more and answers already-cancelled", async () => {
      const { callControl, cancel, expire } = await dialled();
      await cancel.cancel({ projectId: "project-1", scenarioRunId: "run-1" });

      await expect(expire()).resolves.toBe("already-cancelled");
      expect(callControl.endedCalls).toHaveLength(1);
    });
  });
});

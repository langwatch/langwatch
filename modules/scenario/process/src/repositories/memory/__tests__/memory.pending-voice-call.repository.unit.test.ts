/**
 * The contract runs against the memory twin below; the scenario-bound cases beside it pin one
 * headline outcome each, because the parity check reads only `*.test.ts` files.
 * @see specs/features/agents/voice-media-claim.feature
 */
import { describe, expect, it } from "vitest";

import {
  describePendingVoiceCallRepositoryContract,
  freshPendingVoiceCall,
} from "../../__tests__/pending-voice-call.repository.contract.ts";
import { MemoryPendingVoiceCallRepository } from "../memory.pending-voice-call.repository.ts";

function createClock() {
  let now = 0;
  return {
    repository: MemoryPendingVoiceCallRepository.create({ now: () => now }),
    elapse: async (seconds: number) => {
      now += seconds * 1000;
    },
  };
}

describe("MemoryPendingVoiceCallRepository", () => {
  describePendingVoiceCallRepositoryContract(async () => createClock());

  describe("given a stored pending call", () => {
    /** @scenario "A pending call is peeked without being consumed" */
    it("finds it on a second peek", async () => {
      const { repository } = createClock();
      const call = freshPendingVoiceCall();
      await repository.put({ call, ttlSeconds: 60 });
      const key = { scenarioRunId: call.scenarioRunId, nonce: call.nonce };
      await repository.peek(key);

      await expect(repository.peek(key)).resolves.toEqual({ found: true, call });
    });

    /** @scenario "A pending call is claimed once" */
    it("lets the second claim find nothing", async () => {
      const { repository } = createClock();
      const call = freshPendingVoiceCall();
      await repository.put({ call, ttlSeconds: 60 });
      const key = { scenarioRunId: call.scenarioRunId, nonce: call.nonce };

      const claims = [await repository.claim(key), await repository.claim(key)];

      expect(claims).toEqual([
        { claimed: true, call },
        { claimed: false, reason: "unknown" },
      ]);
    });

    /** @scenario "A claim with the wrong nonce finds nothing" */
    it("answers unknown to a claim with another nonce", async () => {
      const { repository } = createClock();
      const call = freshPendingVoiceCall();
      await repository.put({ call, ttlSeconds: 60 });

      await expect(
        repository.claim({ scenarioRunId: call.scenarioRunId, nonce: "another-nonce" }),
      ).resolves.toEqual({ claimed: false, reason: "unknown" });
    });

    /** @scenario "A cancelled run is never claimed" */
    it("refuses a claim after the run is cancelled", async () => {
      const { repository } = createClock();
      const call = freshPendingVoiceCall();
      await repository.put({ call, ttlSeconds: 60 });
      await repository.cancel({ scenarioRunId: call.scenarioRunId, tombstoneTtlSeconds: 600 });

      await expect(
        repository.claim({ scenarioRunId: call.scenarioRunId, nonce: call.nonce }),
      ).resolves.toEqual({ claimed: false, reason: "cancelled" });
    });

    /** @scenario "A cancel reports the state the run was in" */
    it("reports pending, claimed with its SID, and absent", async () => {
      const { repository } = createClock();
      const pending = freshPendingVoiceCall();
      const claimed = freshPendingVoiceCall();
      await repository.put({ call: pending, ttlSeconds: 60 });
      await repository.put({ call: claimed, ttlSeconds: 60 });
      await repository.attachCallSid({ scenarioRunId: claimed.scenarioRunId, callSid: "CA-1" });
      await repository.claim({ scenarioRunId: claimed.scenarioRunId, nonce: claimed.nonce });
      const cancel = (scenarioRunId: string) =>
        repository.cancel({ scenarioRunId, tombstoneTtlSeconds: 600 });

      const outcomes = [
        await cancel(pending.scenarioRunId),
        await cancel(claimed.scenarioRunId),
        await cancel(freshPendingVoiceCall().scenarioRunId),
      ];

      expect(outcomes).toEqual([
        { state: "pending" },
        { state: "claimed", callSid: "CA-1" },
        { state: "absent" },
      ]);
    });

    /** @scenario "A cancel before the call SID is known still ends the call" */
    it("refuses a call SID attached after the cancel", async () => {
      const { repository } = createClock();
      const call = freshPendingVoiceCall();
      await repository.put({ call, ttlSeconds: 60 });
      await repository.cancel({ scenarioRunId: call.scenarioRunId, tombstoneTtlSeconds: 600 });

      await expect(
        repository.attachCallSid({ scenarioRunId: call.scenarioRunId, callSid: "CA-2" }),
      ).resolves.toEqual({ attached: false, reason: "cancelled" });
    });

    /** @scenario "A pending call lapses at its lifetime" */
    it("is no longer found once its lifetime passes", async () => {
      const { repository, elapse } = createClock();
      const call = freshPendingVoiceCall();
      await repository.put({ call, ttlSeconds: 1 });
      await elapse(2);

      await expect(
        repository.peek({ scenarioRunId: call.scenarioRunId, nonce: call.nonce }),
      ).resolves.toEqual({ found: false });
    });
  });

  describe("given a claimed run", () => {
    /** @scenario "A claimed run cannot be put again" */
    it("refuses a second put as claimed and keeps the call SID", async () => {
      const { repository } = createClock();
      const call = freshPendingVoiceCall();
      await repository.put({ call, ttlSeconds: 60 });
      await repository.attachCallSid({ scenarioRunId: call.scenarioRunId, callSid: "CA-9" });
      await repository.claim({ scenarioRunId: call.scenarioRunId, nonce: call.nonce });

      const put = await repository.put({ call, ttlSeconds: 60 });
      const cancelled = await repository.cancel({
        scenarioRunId: call.scenarioRunId,
        tombstoneTtlSeconds: 600,
      });

      expect(put).toEqual({ stored: false, reason: "claimed" });
      expect(cancelled).toEqual({ state: "claimed", callSid: "CA-9" });
    });
  });

  describe("given a cancelled run", () => {
    /** @scenario "A cancelled run's tombstone lapses" */
    it("reads as absent once the tombstone lifetime passes", async () => {
      const { repository, elapse } = createClock();
      const { scenarioRunId } = freshPendingVoiceCall();
      await repository.cancel({ scenarioRunId, tombstoneTtlSeconds: 1 });
      await elapse(2);

      await expect(repository.cancel({ scenarioRunId, tombstoneTtlSeconds: 1 })).resolves.toEqual({
        state: "absent",
      });
    });
  });
});

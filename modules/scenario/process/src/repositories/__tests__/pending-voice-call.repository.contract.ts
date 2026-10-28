/**
 * The one contract every PendingVoiceCallRepository backend keeps. The memory twin runs it as a
 * unit test, Redis as an integration test.
 * @see specs/features/agents/voice-media-claim.feature
 */
import { beforeEach, describe, expect, it } from "vitest";

import type {
  PendingVoiceCall,
  PendingVoiceCallRepository,
} from "../pending-voice-call.repository.ts";

export type PendingVoiceCallContractHarness = {
  repository: PendingVoiceCallRepository;
  /** Moves the backend's clock past `seconds`; Redis sleeps, memory advances an injected clock. */
  elapse: (seconds: number) => Promise<void>;
};

const TTL_SECONDS = 60;
const TOMBSTONE_TTL_SECONDS = 600;

let counter = 0;
/** Ids unique per call, so a shared Redis never sees two tests touch one run. */
export function freshPendingVoiceCall(): PendingVoiceCall {
  counter += 1;
  const unique = `${process.pid}-${Date.now()}-${counter}`;
  return { nonce: `nonce-${unique}`, projectId: "project-1", scenarioRunId: `run-${unique}` };
}

export function describePendingVoiceCallRepositoryContract(
  create: () => Promise<PendingVoiceCallContractHarness>,
): void {
  describe("given a stored pending call", () => {
    describe("when it is peeked twice", () => {
      it("finds the call both times", async () => {
        const { repository } = await create();
        const call = freshPendingVoiceCall();
        await repository.put({ call, ttlSeconds: TTL_SECONDS });
        const key = { scenarioRunId: call.scenarioRunId, nonce: call.nonce };

        await repository.peek(key);

        await expect(repository.peek(key)).resolves.toEqual({ found: true, call });
      });
    });

    describe("when it is stored", () => {
      it("answers stored", async () => {
        const { repository } = await create();

        await expect(
          repository.put({ call: freshPendingVoiceCall(), ttlSeconds: TTL_SECONDS }),
        ).resolves.toEqual({ stored: true });
      });
    });

    describe("when it is claimed twice", () => {
      let repository: PendingVoiceCallRepository;
      let call: PendingVoiceCall;
      let key: { scenarioRunId: string; nonce: string };

      beforeEach(async () => {
        ({ repository } = await create());
        call = freshPendingVoiceCall();
        await repository.put({ call, ttlSeconds: TTL_SECONDS });
        key = { scenarioRunId: call.scenarioRunId, nonce: call.nonce };
      });

      it("answers the call the first time", async () => {
        await expect(
          repository.claim({ scenarioRunId: call.scenarioRunId, nonce: call.nonce }),
        ).resolves.toEqual({ claimed: true, call });
      });

      it("answers unknown the second time", async () => {
        await repository.claim(key);

        await expect(repository.claim(key)).resolves.toEqual({
          claimed: false,
          reason: "unknown",
        });
      });

      it("no longer finds the call", async () => {
        await repository.claim(key);

        await expect(repository.peek(key)).resolves.toEqual({ found: false });
      });
    });

    describe("when it is claimed with another nonce", () => {
      let repository: PendingVoiceCallRepository;
      let call: PendingVoiceCall;

      beforeEach(async () => {
        ({ repository } = await create());
        call = freshPendingVoiceCall();
        await repository.put({ call, ttlSeconds: TTL_SECONDS });
      });

      it("answers unknown", async () => {
        await expect(
          repository.claim({ scenarioRunId: call.scenarioRunId, nonce: "another-nonce" }),
        ).resolves.toEqual({ claimed: false, reason: "unknown" });
      });

      it("leaves the call pending", async () => {
        await repository.claim({ scenarioRunId: call.scenarioRunId, nonce: "another-nonce" });

        await expect(
          repository.peek({ scenarioRunId: call.scenarioRunId, nonce: call.nonce }),
        ).resolves.toEqual({ found: true, call });
      });
    });

    describe("when the run is cancelled", () => {
      it("refuses the claim as cancelled", async () => {
        const { repository } = await create();
        const call = freshPendingVoiceCall();
        await repository.put({ call, ttlSeconds: TTL_SECONDS });
        await repository.cancel({
          scenarioRunId: call.scenarioRunId,
          tombstoneTtlSeconds: TOMBSTONE_TTL_SECONDS,
        });

        await expect(
          repository.claim({ scenarioRunId: call.scenarioRunId, nonce: call.nonce }),
        ).resolves.toEqual({ claimed: false, reason: "cancelled" });
      });

      it("refuses storing another call for the run as cancelled", async () => {
        const { repository } = await create();
        const call = freshPendingVoiceCall();
        await repository.cancel({
          scenarioRunId: call.scenarioRunId,
          tombstoneTtlSeconds: TOMBSTONE_TTL_SECONDS,
        });

        await expect(repository.put({ call, ttlSeconds: TTL_SECONDS })).resolves.toEqual({
          stored: false,
          reason: "cancelled",
        });
      });

      it("removes the pending entry", async () => {
        const { repository } = await create();
        const call = freshPendingVoiceCall();
        await repository.put({ call, ttlSeconds: TTL_SECONDS });
        await repository.cancel({
          scenarioRunId: call.scenarioRunId,
          tombstoneTtlSeconds: TOMBSTONE_TTL_SECONDS,
        });

        await expect(
          repository.peek({ scenarioRunId: call.scenarioRunId, nonce: call.nonce }),
        ).resolves.toEqual({ found: false });
      });
    });

    describe("when its lifetime passes", () => {
      let repository: PendingVoiceCallRepository;
      let elapse: PendingVoiceCallContractHarness["elapse"];
      let call: PendingVoiceCall;

      beforeEach(async () => {
        ({ repository, elapse } = await create());
        call = freshPendingVoiceCall();
        await repository.put({ call, ttlSeconds: 1 });
      });

      it("is no longer found", async () => {
        await elapse(2);

        await expect(
          repository.peek({ scenarioRunId: call.scenarioRunId, nonce: call.nonce }),
        ).resolves.toEqual({ found: false });
      });

      it("cannot be claimed", async () => {
        await elapse(2);

        await expect(
          repository.claim({ scenarioRunId: call.scenarioRunId, nonce: call.nonce }),
        ).resolves.toEqual({ claimed: false, reason: "unknown" });
      });
    });
  });

  describe("given a claimed run", () => {
    describe("when another call is put for it", () => {
      it("refuses the put as claimed and keeps the call SID", async () => {
        const { repository } = await create();
        const call = freshPendingVoiceCall();
        await repository.put({ call, ttlSeconds: TTL_SECONDS });
        await repository.attachCallSid({ scenarioRunId: call.scenarioRunId, callSid: "CA-9" });
        await repository.claim({ scenarioRunId: call.scenarioRunId, nonce: call.nonce });

        const put = await repository.put({ call, ttlSeconds: TTL_SECONDS });
        const cancelled = await repository.cancel({
          scenarioRunId: call.scenarioRunId,
          tombstoneTtlSeconds: TOMBSTONE_TTL_SECONDS,
        });

        expect(put).toEqual({ stored: false, reason: "claimed" });
        expect(cancelled).toEqual({ state: "claimed", callSid: "CA-9" });
      });
    });
  });

  describe("given a cancel", () => {
    describe("when the run has a pending call", () => {
      let repository: PendingVoiceCallRepository;
      let call: PendingVoiceCall;

      beforeEach(async () => {
        ({ repository } = await create());
        call = freshPendingVoiceCall();
        await repository.put({ call, ttlSeconds: TTL_SECONDS });
      });

      it("reports pending", async () => {
        await expect(
          repository.cancel({
            scenarioRunId: call.scenarioRunId,
            tombstoneTtlSeconds: TOMBSTONE_TTL_SECONDS,
          }),
        ).resolves.toEqual({ state: "pending" });
      });

      it("reports pending with the call SID once it is attached", async () => {
        await repository.attachCallSid({ scenarioRunId: call.scenarioRunId, callSid: "CA-1" });

        await expect(
          repository.cancel({
            scenarioRunId: call.scenarioRunId,
            tombstoneTtlSeconds: TOMBSTONE_TTL_SECONDS,
          }),
        ).resolves.toEqual({ state: "pending", callSid: "CA-1" });
      });
    });

    describe("when the run has been claimed", () => {
      let repository: PendingVoiceCallRepository;
      let call: PendingVoiceCall;

      beforeEach(async () => {
        ({ repository } = await create());
        call = freshPendingVoiceCall();
        await repository.put({ call, ttlSeconds: TTL_SECONDS });
      });

      it("reports claimed with the call SID", async () => {
        await repository.attachCallSid({ scenarioRunId: call.scenarioRunId, callSid: "CA-2" });
        await repository.claim({ scenarioRunId: call.scenarioRunId, nonce: call.nonce });

        await expect(
          repository.cancel({
            scenarioRunId: call.scenarioRunId,
            tombstoneTtlSeconds: TOMBSTONE_TTL_SECONDS,
          }),
        ).resolves.toEqual({ state: "claimed", callSid: "CA-2" });
      });

      it("refuses a late call SID as cancelled", async () => {
        await repository.claim({ scenarioRunId: call.scenarioRunId, nonce: call.nonce });
        await repository.cancel({
          scenarioRunId: call.scenarioRunId,
          tombstoneTtlSeconds: TOMBSTONE_TTL_SECONDS,
        });

        await expect(
          repository.attachCallSid({ scenarioRunId: call.scenarioRunId, callSid: "CA-3" }),
        ).resolves.toEqual({ attached: false, reason: "cancelled" });
      });
    });

    describe("when the run was already cancelled", () => {
      it("reports cancelled and keeps the call SID", async () => {
        const { repository } = await create();
        const call = freshPendingVoiceCall();
        await repository.put({ call, ttlSeconds: TTL_SECONDS });
        await repository.attachCallSid({ scenarioRunId: call.scenarioRunId, callSid: "CA-7" });
        await repository.cancel({
          scenarioRunId: call.scenarioRunId,
          tombstoneTtlSeconds: TOMBSTONE_TTL_SECONDS,
        });

        await expect(
          repository.cancel({
            scenarioRunId: call.scenarioRunId,
            tombstoneTtlSeconds: TOMBSTONE_TTL_SECONDS,
          }),
        ).resolves.toEqual({ state: "cancelled", callSid: "CA-7" });
      });
    });

    describe("when the run is unknown", () => {
      it("reports absent", async () => {
        const { repository } = await create();

        await expect(
          repository.cancel({
            scenarioRunId: freshPendingVoiceCall().scenarioRunId,
            tombstoneTtlSeconds: TOMBSTONE_TTL_SECONDS,
          }),
        ).resolves.toEqual({ state: "absent" });
      });
    });

    describe("when the call SID is not known yet", () => {
      it("answers cancelled when the SID is attached afterwards", async () => {
        const { repository } = await create();
        const call = freshPendingVoiceCall();
        await repository.put({ call, ttlSeconds: TTL_SECONDS });
        await repository.cancel({
          scenarioRunId: call.scenarioRunId,
          tombstoneTtlSeconds: TOMBSTONE_TTL_SECONDS,
        });

        await expect(
          repository.attachCallSid({ scenarioRunId: call.scenarioRunId, callSid: "CA-4" }),
        ).resolves.toEqual({ attached: false, reason: "cancelled" });
      });
    });

    describe("when the tombstone lifetime passes", () => {
      it("reads the run as absent again", async () => {
        const { repository, elapse } = await create();
        const call = freshPendingVoiceCall();
        await repository.cancel({ scenarioRunId: call.scenarioRunId, tombstoneTtlSeconds: 1 });

        await elapse(2);

        await expect(
          repository.cancel({ scenarioRunId: call.scenarioRunId, tombstoneTtlSeconds: 1 }),
        ).resolves.toEqual({ state: "absent" });
      });
    });
  });

  describe("given a call SID to attach", () => {
    describe("when the run has a pending call", () => {
      it("attaches it", async () => {
        const { repository } = await create();
        const call = freshPendingVoiceCall();
        await repository.put({ call, ttlSeconds: TTL_SECONDS });

        await expect(
          repository.attachCallSid({ scenarioRunId: call.scenarioRunId, callSid: "CA-5" }),
        ).resolves.toEqual({ attached: true });
      });
    });

    describe("when the run is unknown", () => {
      it("answers unknown", async () => {
        const { repository } = await create();

        await expect(
          repository.attachCallSid({
            scenarioRunId: freshPendingVoiceCall().scenarioRunId,
            callSid: "CA-6",
          }),
        ).resolves.toEqual({ attached: false, reason: "unknown" });
      });
    });
  });
}

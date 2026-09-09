/**
 * @see specs/features/agents/voice-agents-v1.feature
 */

import { describe, expect, it } from "vitest";
import {
  initialTalkState,
  MIC_DENIED_MESSAGE,
  MINT_FAILED_PREFIX,
  NO_KEY_MESSAGE,
  type TalkState,
  talkReducer,
} from "../talkToItMachine";

function drive(events: Parameters<typeof talkReducer>[1][]): TalkState {
  return events.reduce(talkReducer, initialTalkState);
}

describe("talkReducer", () => {
  describe("when the microphone is denied", () => {
    it("moves to a retryable error, not stuck on connecting, and writes no run", () => {
      const state = drive([{ type: "START" }, { type: "MIC_DENIED" }]);
      expect(state).toEqual({
        kind: "error",
        code: "mic_denied",
        message: MIC_DENIED_MESSAGE,
      });
    });
  });

  describe("when the mint fails", () => {
    /** @scenario "A mint failure shows a retry panel and starts no run" */
    it("shows the retryable message and never reaches a run", () => {
      const state = drive([
        { type: "START" },
        { type: "MINT_FAILED", code: "mint_failed", message: "gateway down" },
      ]);
      expect(state.kind).toBe("error");
      if (state.kind === "error") {
        expect(state.message).toBe(`${MINT_FAILED_PREFIX}: gateway down`);
      }
    });

    it("names the missing key and keeps the Add-key branch when there is no key", () => {
      const state = drive([
        { type: "START" },
        { type: "MINT_FAILED", code: "key_missing", message: "ignored" },
      ]);
      expect(state).toMatchObject({
        code: "key_missing",
        message: NO_KEY_MESSAGE,
      });
    });
  });

  describe("when the call limit elapses", () => {
    /** @scenario "The timer turns red in the final 60 seconds and the call ends at the limit" */
    it("reaches the post-call view with the cut flag and no hang-up event", () => {
      const state = drive([
        { type: "START" },
        { type: "CONNECTED", conversationId: "conv_1" },
        { type: "LIMIT_REACHED" },
      ]);
      expect(state).toMatchObject({ kind: "saving", cutAtLimit: true });
    });
  });

  describe("when a name is required to save", () => {
    it("moves to needs-name carrying the transcript and cut flag", () => {
      const state = drive([
        { type: "START" },
        { type: "CONNECTED", conversationId: "conv_1" },
        { type: "TRANSCRIPT", turn: { role: "caller", text: "hi" } },
        { type: "HANG_UP" },
        { type: "NAME_REQUIRED" },
      ]);
      expect(state).toMatchObject({
        kind: "needsName",
        transcript: [{ role: "caller", text: "hi" }],
      });
    });
  });

  describe("when the run is saved with a failed fetch", () => {
    it("reaches done carrying the fetch-failed flag", () => {
      const state = drive([
        { type: "START" },
        { type: "CONNECTED", conversationId: "conv_1" },
        { type: "HANG_UP" },
        {
          type: "SAVED",
          runId: "voicecall_1",
          agentId: "agent_1",
          hasAudio: false,
          fetchFailed: true,
        },
      ]);
      expect(state).toMatchObject({
        kind: "done",
        runId: "voicecall_1",
        fetchFailed: true,
        hasAudio: false,
      });
    });
  });
});

/**
 * @vitest-environment node
 *
 * The thinking line may only say TRUE things.
 *
 * It used to cycle whimsical verbs on a timer for as long as a turn was open,
 * whether or not anything was happening. On a turn whose worker never spawned it
 * spent ninety-seven seconds claiming "Writing a TODO list…", "Calling one more
 * tool…", "Reading the whole file…" — while nothing was running and not one
 * token had arrived. That is not a cosmetic bug: it made a DEAD turn read as a
 * healthy one, and "Langy is slow" was chased for a whole session before anyone
 * noticed the turn had never started.
 *
 * These tests are the guarantee that it cannot happen again.
 */
import { describe, expect, it } from "vitest";
import {
  langyThinkingLine,
  THINKING_SLOW_MS,
  THINKING_STILL_STARTING_MS,
  THINKING_STUCK_MS,
} from "../logic/langyThinkingLine";
import { LANGY_THINKING_VERBS } from "../components/langyThinkingVerbs";

const assistant = (parts: unknown[]) => ({ role: "assistant", parts: parts as never });
const user = { role: "user", parts: [{ type: "text", text: "hi" }] };

describe("langyThinkingLine", () => {
  describe("given a turn where NOTHING has happened", () => {
    /** The 97-second lie, in one test. */
    it("never invents work — it says it is starting up", () => {
      const line = langyThinkingLine({
        messages: [user, assistant([])],
        elapsedMs: 3_000,
      });
      expect(line.text).toBe("Starting up…");
      expect(line.tone).toBe("waiting");
      // And CRUCIALLY: no cycling. Cycling reads as progress.
      expect(line.allowWhimsy).toBe(false);
    });

    it("admits it is still starting once the silence stops being normal", () => {
      const line = langyThinkingLine({
        messages: [user],
        elapsedMs: THINKING_STILL_STARTING_MS,
      });
      expect(line.text).toBe("Still starting up…");
      expect(line.allowWhimsy).toBe(false);
    });

    it("says it is slow when it is slow", () => {
      const line = langyThinkingLine({ messages: [user], elapsedMs: THINKING_SLOW_MS });
      expect(line.text).toContain("longer than usual");
      expect(line.allowWhimsy).toBe(false);
    });

    it("eventually LOOKS STUCK, because it is", () => {
      // The line that would have saved a session: at 97s, with nothing on the
      // wire, the honest word is "stuck" — not "Reading the whole file".
      const line = langyThinkingLine({ messages: [user], elapsedMs: 97_000 });
      expect(line.tone).toBe("stuck");
      expect(line.text).toContain("stuck");
      expect(line.allowWhimsy).toBe(false);
      expect(THINKING_STUCK_MS).toBeLessThan(97_000);
    });

    it("escalates monotonically — it never gets less worried with time", () => {
      const tones = [0, THINKING_STILL_STARTING_MS, THINKING_SLOW_MS, THINKING_STUCK_MS].map(
        (elapsedMs) => langyThinkingLine({ messages: [user], elapsedMs }).tone,
      );
      expect(tones).toEqual(["waiting", "waiting", "waiting", "stuck"]);
    });
  });

  describe("given a tool that is actually running", () => {
    it("says what it really is, read off the tool stream", () => {
      const line = langyThinkingLine({
        messages: [
          user,
          assistant([
            {
              type: "tool-bash",
              state: "input-available",
              input: { command: "langwatch trace search --limit 4" },
            },
          ]),
        ],
        elapsedMs: 5_000,
      });
      expect(line.tone).toBe("working");
      // The real command, not a guess about it.
      expect(line.text.toLowerCase()).toContain("trace");
      expect(line.allowWhimsy).toBe(false);
    });

    it("ignores a tool that has already settled — that is not what is running", () => {
      const line = langyThinkingLine({
        messages: [
          user,
          assistant([
            {
              type: "tool-bash",
              state: "output-available",
              input: { command: "langwatch trace search" },
            },
          ]),
        ],
        elapsedMs: 5_000,
      });
      // Nothing is running and nothing has been written, so we are waiting.
      expect(line.tone).toBe("waiting");
    });
  });

  describe("given the model is genuinely generating", () => {
    it("says so, and only THEN allows whimsy", () => {
      // A joke about Langy's character claims nothing about the work, and here
      // the work is real: tokens are arriving.
      const line = langyThinkingLine({
        messages: [user, assistant([{ type: "text", text: "Here are 4 traces" }])],
        elapsedMs: 5_000,
      });
      expect(line.tone).toBe("working");
      expect(line.allowWhimsy).toBe(true);
    });

    it("counts Stream B's optimistic tokens as real generation", () => {
      const line = langyThinkingLine({
        messages: [user, assistant([])],
        elapsedMs: 5_000,
        optimisticText: "Here",
      });
      expect(line.tone).toBe("working");
      expect(line.allowWhimsy).toBe(true);
    });

    it("does not go stuck while tokens are still arriving", () => {
      const line = langyThinkingLine({
        messages: [user, assistant([{ type: "text", text: "still writing" }])],
        elapsedMs: 200_000,
      });
      expect(line.tone).toBe("working");
    });
  });

  describe("the whimsy pool itself", () => {
    /**
     * The pool is only ever shown while the model is genuinely thinking, so a
     * verb may joke about Langy's CHARACTER but must never CLAIM AN ACT.
     * "Bribing the GPUs" is a joke. "Reading the whole file" is a false
     * statement — and it was the one we told for 97 seconds.
     */
    it("contains no verb that claims work Langy might not be doing", () => {
      const claims = [
        "Writing a TODO list",
        "Calling one more tool",
        "Reading the whole file",
        "Chasing a span",
        "Untangling a trace",
        "Tailing the spans",
        "Counting the tokens",
        "Evaluating the eval",
      ];
      for (const claim of claims) {
        expect(LANGY_THINKING_VERBS, claim).not.toContain(claim);
      }
    });

    it("keeps the jokes — they were never the problem", () => {
      expect(LANGY_THINKING_VERBS).toContain("Bribing the GPUs");
      expect(LANGY_THINKING_VERBS).toContain("Blaming the NS");
    });
  });
});

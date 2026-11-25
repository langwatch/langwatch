import { describe, expect, it, vi } from "vitest";

import { ScriptCallBatcher } from "../scriptCallBatcher.ts";

function recordingBatcher() {
  const one = vi.fn(async (input: string) => `one:${input}`);
  const many = vi.fn(async (inputs: readonly string[]): Promise<PromiseSettledResult<string>[]> =>
    inputs.map((input) =>
      input === "stale"
        ? { status: "rejected", reason: new Error(`fenced:${input}`) }
        : { status: "fulfilled", value: `many:${input}` },
    ),
  );
  return { batcher: new ScriptCallBatcher<string, string>({ one, many }), one, many };
}

describe("ScriptCallBatcher", () => {
  describe("given a lone call", () => {
    /** @scenario "A lone completion goes alone and completions issued together share one call" */
    it("sends it through the single call, as before", async () => {
      const { batcher, one, many } = recordingBatcher();

      expect(await batcher.call("a")).toBe("one:a");
      expect(one).toHaveBeenCalledTimes(1);
      expect(many).not.toHaveBeenCalled();
    });
  });

  describe("given calls issued in the same turn", () => {
    /** @scenario "A lone completion goes alone and completions issued together share one call" */
    it("sends them in one call and hands each caller its own answer", async () => {
      const { batcher, one, many } = recordingBatcher();

      const answers = await Promise.allSettled(["a", "stale", "b"].map((i) => batcher.call(i)));

      expect(many).toHaveBeenCalledTimes(1);
      expect(many).toHaveBeenCalledWith(["a", "stale", "b"]);
      expect(one).not.toHaveBeenCalled();
      expect(answers.map((answer) => answer.status)).toEqual([
        "fulfilled",
        "rejected",
        "fulfilled",
      ]);
      expect(answers[0]).toEqual({ status: "fulfilled", value: "many:a" });
    });
  });

  describe("given the shared call fails outright", () => {
    it("fails every caller in it", async () => {
      const { batcher, many } = recordingBatcher();
      many.mockRejectedValueOnce(new Error("connection lost"));

      const answers = await Promise.allSettled([batcher.call("a"), batcher.call("b")]);

      expect(answers.map((answer) => answer.status)).toEqual(["rejected", "rejected"]);
    });
  });

  describe("given calls in separate turns", () => {
    it("sends each alone", async () => {
      const { batcher, one, many } = recordingBatcher();

      await batcher.call("a");
      await batcher.call("b");

      expect(one).toHaveBeenCalledTimes(2);
      expect(many).not.toHaveBeenCalled();
    });
  });
});

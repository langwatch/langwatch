/**
 * The readers that turn a turn's tool parts into what the panel draws.
 *
 * Two properties are pinned here that the render tests cannot see:
 *
 *   1. they are MEMOISED on the parts array they read. Drawing one message asks
 *      the same four readers at least twice (MessageContent's "is there anything
 *      to show?" guard, then LangyActivityParts to actually show it), and each
 *      walk JSON-parses and schema-validates every CLI document it passes;
 *   2. a failure is recognised from STRUCTURE or from a line that ANNOUNCES one
 *      — never from a phrase appearing somewhere in a successful command's
 *      stdout.
 */
import { describe, expect, it } from "vitest";

import {
  toActivityGroups,
  toCapabilityCalls,
  toFailedToolCalls,
} from "../components/LangyToolActivity";

/** A settled `bash` call, with whatever the command printed. */
function bashCall({
  id = "call-1",
  command,
  output,
}: {
  id?: string;
  command: string;
  output: unknown;
}) {
  return {
    type: "tool-bash",
    toolCallId: id,
    state: "output-available",
    input: { command },
    output,
  };
}

describe("langy activity readers", () => {
  describe("given the same parts array is read more than once", () => {
    it("answers from the first read instead of walking the parts again", () => {
      const parts = [
        bashCall({
          command: "langwatch trace search --format json",
          output: JSON.stringify({ traces: [] }),
        }),
      ];

      // Two different views over ONE parts array: the memo keys on the parts,
      // which is what makes MessageContent's guard and the render itself share
      // a single walk.
      expect(toCapabilityCalls({ parts })).toBe(toCapabilityCalls({ parts }));
      expect(toActivityGroups({ parts })).toBe(toActivityGroups({ parts }));
      expect(toFailedToolCalls({ parts })).toBe(toFailedToolCalls({ parts }));
    });

    it("reads a fresh array afresh — a new token is a new answer", () => {
      const first = [bashCall({ command: "cat notes.md", output: "ok" })];
      const second = [
        ...first,
        bashCall({ id: "call-2", command: "cat other.md", output: "ok" }),
      ];

      expect(toActivityGroups({ parts: second })).not.toBe(
        toActivityGroups({ parts: first }),
      );
      // Both shell calls collapse into one group, so the second read is only
      // visibly newer in the calls it carries.
      expect(toActivityGroups({ parts: first })[0]?.calls).toHaveLength(1);
      expect(toActivityGroups({ parts: second })[0]?.calls).toHaveLength(2);
    });
  });

  describe("given a command that SUCCEEDED but printed a failure phrase", () => {
    const parts = [
      bashCall({
        command: 'grep -rn "failed to" src/',
        output: [
          "src/server/queue.ts:12:  // failed to enqueue, retry later",
          'src/server/queue.ts:44:    throw new Error("failed to connect");',
        ].join("\n"),
      }),
    ];

    it("does not turn it into a failure", () => {
      expect(toFailedToolCalls({ parts })).toHaveLength(0);
    });

    it("keeps it in the completed receipt, where the reader can see it ran", () => {
      const [group] = toActivityGroups({ parts });
      expect(group?.done).toBe(true);
    });
  });

  describe("given a command whose output QUOTES a request failure", () => {
    // A tailed log is data, not this call's verdict. The old substring match
    // took the line as proof the step broke.
    const parts = [
      bashCall({
        command: "tail -n 3 /var/log/app.log",
        output: "2026-07-28T09:00:00Z WARN request failed, retrying in 2s",
      }),
    ];

    it("reads it as the successful command it was", () => {
      expect(toFailedToolCalls({ parts })).toHaveLength(0);
      expect(toActivityGroups({ parts })).toHaveLength(1);
    });
  });

  describe("given the CLI announced its own failure", () => {
    it("still recognises the marker at the head of a line", () => {
      const parts = [
        bashCall({
          command: "langwatch trace search --format json",
          output: JSON.stringify({
            kind: "text",
            text: "- Searching traces...\n✖ Failed to search traces: fetch failed",
          }),
        }),
      ];

      expect(toFailedToolCalls({ parts })).toHaveLength(1);
      expect(toActivityGroups({ parts })).toHaveLength(0);
    });

    it("recognises a handled failure document even with no marker in sight", () => {
      const parts = [
        bashCall({
          command: "langwatch scenario create Demo --format json",
          output: JSON.stringify({
            ok: false,
            error: {
              code: "resource_limit_exceeded",
              message: "Your plan doesn't include another scenario.",
              httpStatus: 403,
              meta: { limitType: "scenarios" },
            },
          }),
        }),
      ];

      expect(toFailedToolCalls({ parts })).toHaveLength(1);
      expect(toActivityGroups({ parts })).toHaveLength(0);
    });
  });
});

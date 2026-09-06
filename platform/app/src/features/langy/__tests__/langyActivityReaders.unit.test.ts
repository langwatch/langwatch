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
  describe("given a settled tool call to read", () => {
    describe("when the same parts array is asked for twice", () => {
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
    });

    describe("when a streamed token appends a call to a fresh array", () => {
      it("reads the new array afresh — a new token is a new answer", () => {
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

    describe("when the readers classify the call", () => {
      it("does not turn it into a failure", () => {
        expect(toFailedToolCalls({ parts })).toHaveLength(0);
      });

      it("keeps it in the completed receipt, where the reader can see it ran", () => {
        const groups = toActivityGroups({ parts });
        expect(groups).toHaveLength(1);
        expect(groups[0]?.done).toBe(true);
      });
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

    describe("when the readers classify the call", () => {
      it("reads it as the successful command it was", () => {
        expect(toFailedToolCalls({ parts })).toHaveLength(0);
        expect(toActivityGroups({ parts })).toHaveLength(1);
      });
    });
  });

  describe("given a tailed log whose own lines START with a failure phrase", () => {
    // Anchoring the markers to the head of a line narrowed the old substring
    // match but did not close it: a log file prints its own lines at the head
    // of a line too. `tail` exited 0, the stdout is not JSON, and the server
    // passes a non-LangWatch shell command through the CLI envelope untouched
    // — so there is no `{kind:"text"}` document, and the raw stdout belongs to
    // whatever the command happened to print. Reading it drew a red error card
    // for a command that worked and deleted the step from the receipt.
    const parts = [
      bashCall({
        command: "tail -n 20 /var/log/app.log",
        output: [
          "failed to connect to redis, retrying in 2s",
          "recovered after 1 retry",
        ].join("\n"),
      }),
    ];

    describe("when the readers classify the call", () => {
      it("reads it as the successful command it was", () => {
        expect(toFailedToolCalls({ parts })).toHaveLength(0);
      });

      it("keeps the step in the completed receipt", () => {
        const [group] = toActivityGroups({ parts });
        expect(group?.done).toBe(true);
      });
    });
  });

  describe("given a shell call whose output is a bare `✖` line", () => {
    // The sharpest form of the same thing: a build tool's own failure glyph in
    // stdout, from a command the agent ran on purpose and which exited 0.
    const parts = [
      bashCall({
        command: "pnpm lint --reporter compact",
        output: "✖ 3 problems (3 warnings, 0 errors)",
      }),
    ];

    describe("when the readers classify the call", () => {
      it("does not promote the console line to the call's verdict", () => {
        expect(toFailedToolCalls({ parts })).toHaveLength(0);
        expect(toActivityGroups({ parts })).toHaveLength(1);
      });
    });
  });

  describe("given the CLI announced its own failure", () => {
    describe("when the marker heads a line of the output", () => {
      it("still reads the call as failed", () => {
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
    });

    describe("when a handled failure document arrives with no marker in sight", () => {
      it("reads the failure off the document's own shape", () => {
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
});

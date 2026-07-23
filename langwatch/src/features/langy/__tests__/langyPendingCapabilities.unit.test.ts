/**
 * The progressive start-frame path begins here: a RUNNING CLI call's pending
 * card carries the parsed command (resource, verb, flags), which is what lets
 * the card start fetching matching rows before the agent's result exists.
 * A running call that is not a CLI invocation carries no command and renders
 * the plain pending shell.
 */
import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import { toPendingCapabilities } from "../components/LangyToolActivity";

function message(parts: unknown[]): UIMessage {
  return { id: "m1", role: "assistant", parts } as unknown as UIMessage;
}

describe("toPendingCapabilities", () => {
  describe("given a running trace search (start frame, no output yet)", () => {
    it("carries the parsed command so the card can hydrate the query live", () => {
      const pending = toPendingCapabilities(
        message([
          {
            type: "tool-bash",
            toolCallId: "t1",
            state: "input-available",
            input: {
              command:
                'langwatch trace search -q "checkout failed" --limit 5 --format json',
            },
          },
        ]),
      );

      expect(pending).toHaveLength(1);
      expect(pending[0]!.command).toEqual({
        resource: "trace",
        verb: "search",
        query: { q: "checkout failed", limit: "5", format: "json" },
      });
      expect(pending[0]!.progress.headline).toBe("Searching traces");
    });
  });

  describe("given the call settles", () => {
    it("stops being pending — the settled card takes over", () => {
      const pending = toPendingCapabilities(
        message([
          {
            type: "tool-bash",
            toolCallId: "t1",
            state: "output-available",
            input: { command: "langwatch trace search --format json" },
            output: '{"traces":[],"pagination":{"totalHits":0}}',
          },
        ]),
      );
      expect(pending).toHaveLength(0);
    });
  });

  describe("given a running call that is not a LangWatch capability", () => {
    it("is not a pending capability at all", () => {
      const pending = toPendingCapabilities(
        message([
          {
            type: "tool-bash",
            toolCallId: "t1",
            state: "input-available",
            input: { command: "pnpm test:unit" },
          },
        ]),
      );
      expect(pending).toHaveLength(0);
    });
  });
});

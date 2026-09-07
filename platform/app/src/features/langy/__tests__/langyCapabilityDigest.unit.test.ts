/**
 * The client side of the digest: reading a command's identity + flags off a
 * tool call from the START frame, and resolving the digest for a settled one —
 * recorded when the durable part carries a valid one, recomputed via the
 * shared extractor otherwise (live frames, old turns).
 */
import { describe, expect, it } from "vitest";
import {
  commandOfToolCall,
  digestOfToolCall,
} from "../logic/langyCapabilityDigest";

describe("commandOfToolCall", () => {
  describe("given a shell call carrying a LangWatch command (start frame)", () => {
    it("reads the resource, verb and parsed flags before any output exists", () => {
      expect(
        commandOfToolCall({
          name: "bash",
          input: {
            command:
              'langwatch trace search -q "refund policy" --limit 5 --format json',
          },
        }),
      ).toEqual({
        resource: "trace",
        verb: "search",
        query: { q: "refund policy", limit: "5", format: "json" },
      });
    });
  });

  describe("given a call the envelope already re-typed", () => {
    it("still reads the flags off the original command input", () => {
      expect(
        commandOfToolCall({
          name: "langwatch.dataset.list",
          input: { command: "langwatch dataset list --format json" },
        }),
      ).toEqual({
        resource: "dataset",
        verb: "list",
        query: { format: "json" },
      });
    });

    it("uses a structured input as the query when no command string exists", () => {
      expect(
        commandOfToolCall({
          name: "langwatch.trace.search",
          input: { query: "checkout failed" },
        }),
      ).toEqual({
        resource: "trace",
        verb: "search",
        query: { query: "checkout failed" },
      });
    });
  });

  describe("given a call that is not a LangWatch CLI invocation", () => {
    it("resolves to null for a plain shell command", () => {
      expect(
        commandOfToolCall({ name: "bash", input: { command: "pnpm test" } }),
      ).toBeNull();
    });

    it("resolves to null for a non-CLI tool", () => {
      expect(
        commandOfToolCall({ name: "read", input: { filePath: "a.ts" } }),
      ).toBeNull();
    });
  });
});

describe("digestOfToolCall", () => {
  const searchInput = {
    command: "langwatch trace search --limit 2 --format json",
  };

  describe("given the durable part carries a recorded digest", () => {
    it("uses it after validating", () => {
      const recorded = {
        resource: "trace",
        verb: "search",
        strategy: "id-ref",
        ids: ["trace_1"],
        counts: { returned: 1, total: 1 },
      };
      expect(
        digestOfToolCall({
          name: "langwatch.trace.search",
          input: searchInput,
          output: "",
          digest: recorded,
        }),
      ).toEqual(recorded);
    });

    it("recomputes when the recorded digest does not validate", () => {
      const digest = digestOfToolCall({
        name: "langwatch.trace.search",
        input: searchInput,
        output:
          '{"traces":[{"trace_id":"trace_1"}],"pagination":{"totalHits":1}}',
        digest: { strategy: "made-up" },
      });
      expect(digest?.strategy).toBe("id-ref");
      expect(digest?.ids).toEqual(["trace_1"]);
    });
  });

  describe("given a live end frame (no recorded digest)", () => {
    it("computes the same digest the server records, from the same extractor", () => {
      const digest = digestOfToolCall({
        name: "langwatch.trace.search",
        input: searchInput,
        output:
          '{"traces":[{"trace_id":"trace_1"},{"trace_id":"trace_2"}],"pagination":{"totalHits":34}}',
      });
      expect(digest).toEqual({
        resource: "trace",
        verb: "search",
        strategy: "id-ref",
        ids: ["trace_1", "trace_2"],
        counts: { returned: 2, total: 34 },
        query: { limit: "2", format: "json" },
      });
    });
  });

  describe("given a call that is not a LangWatch CLI invocation", () => {
    it("resolves to null — there is no reference to hydrate from", () => {
      expect(
        digestOfToolCall({
          name: "bash",
          input: { command: "ls -la" },
          output: "total 4",
        }),
      ).toBeNull();
    });
  });
});

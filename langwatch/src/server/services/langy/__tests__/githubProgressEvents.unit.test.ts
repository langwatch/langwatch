/**
 * @vitest-environment node
 *
 * The progress sentinels are wire-protocol between the worker skill, the
 * chat-handler stream, and the in-chat steps card. If parsing diverges from
 * what `github.md` emits we either render no steps (silent regression) or
 * spam stored conversations with raw sentinels. Pin the contract.
 */
import { describe, expect, it } from "vitest";
import { parseGithubProgressEvents } from "../githubProgressEvents";

describe("parseGithubProgressEvents", () => {
  describe("when there are no sentinels", () => {
    it("returns no events and leaves the text alone", () => {
      const { events, cleanedText } = parseGithubProgressEvents(
        "Cloning the repo and pushing a branch.",
      );
      expect(events).toEqual([]);
      expect(cleanedText).toBe("Cloning the repo and pushing a branch.");
    });
  });

  describe("when one sentinel rides inline", () => {
    it("emits the event and removes the marker", () => {
      const { events, cleanedText } = parseGithubProgressEvents(
        "Working on it… [langy:progress:cloning:acme/foo] one sec.",
      );
      expect(events).toEqual([{ stage: "cloning", detail: "acme/foo" }]);
      expect(cleanedText).toContain("Working on it");
      expect(cleanedText).not.toContain("langy:progress");
    });
  });

  describe("when a sentinel has no detail suffix", () => {
    it("emits the event with no detail", () => {
      const { events } = parseGithubProgressEvents("[langy:progress:branched]");
      expect(events).toEqual([{ stage: "branched" }]);
    });
  });

  describe("when an unknown stage appears", () => {
    it("ignores it (closed enum, no breakage on skill drift)", () => {
      const { events, cleanedText } = parseGithubProgressEvents(
        "[langy:progress:teleporting:somewhere] hmm",
      );
      expect(events).toEqual([]);
      // Still cleaned — we don't want noise in the rendered text.
      expect(cleanedText).toBe("hmm");
    });
  });

  describe("when a full PR flow's events stream by in order", () => {
    it("returns them in the order emitted", () => {
      const text = [
        "Starting…",
        "[langy:progress:cloning:acme/foo]",
        "[langy:progress:cloned:acme/foo]",
        "[langy:progress:branched:langy/fix-typo]",
        "[langy:progress:edited:src/index.ts]",
        "[langy:progress:committed:fix: typo]",
        "[langy:progress:pushed:langy/fix-typo]",
        "[langy:progress:opening_pr:acme/foo]",
        "[langy:progress:opened:acme/foo#42]",
        "Opened https://github.com/acme/foo/pull/42.",
      ].join("\n");
      const { events, cleanedText } = parseGithubProgressEvents(text);
      expect(events.map((e) => e.stage)).toEqual([
        "cloning",
        "cloned",
        "branched",
        "edited",
        "committed",
        "pushed",
        "opening_pr",
        "opened",
      ]);
      // PR URL must survive — extractGithubPrLinks runs on this same text.
      expect(cleanedText).toContain("https://github.com/acme/foo/pull/42");
    });
  });
});

/**
 * @vitest-environment node
 *
 * The strip helper backs two paths (persistence + UI rendering). If they
 * diverge, history-reload re-shows the connect card and exported transcripts
 * carry raw sentinel markers. Pin the contract here.
 */
import { describe, expect, it } from "vitest";
import {
  CONNECT_GITHUB_SENTINEL,
  stripLangySentinels,
} from "../langySentinels";

describe("stripLangySentinels", () => {
  describe("when the text has no sentinels", () => {
    it("returns it unchanged", () => {
      expect(stripLangySentinels("Hello, world.")).toBe("Hello, world.");
    });
  });

  describe("when the connect-github sentinel rides inline", () => {
    it("removes it from the persisted body", () => {
      const text = `${CONNECT_GITHUB_SENTINEL}\n\nGitHub isn't connected yet.`;
      expect(stripLangySentinels(text)).toBe("GitHub isn't connected yet.");
      expect(stripLangySentinels(text)).not.toContain(CONNECT_GITHUB_SENTINEL);
    });
  });

  describe("when both sentinel types appear in one reply", () => {
    it("strips both and leaves the surrounding prose", () => {
      const text = [
        "Cloning…",
        "[langy:progress:cloning:acme/foo]",
        "Done — see https://github.com/acme/foo/pull/42",
        CONNECT_GITHUB_SENTINEL,
      ].join("\n");
      const out = stripLangySentinels(text);
      expect(out).not.toContain("[langy:progress");
      expect(out).not.toContain(CONNECT_GITHUB_SENTINEL);
      // PR URL survives — the cap counter + PR card both depend on it.
      expect(out).toContain("https://github.com/acme/foo/pull/42");
    });
  });

  describe("when the connect sentinel appears twice", () => {
    it("removes every occurrence", () => {
      const text = `${CONNECT_GITHUB_SENTINEL} foo ${CONNECT_GITHUB_SENTINEL}`;
      expect(stripLangySentinels(text)).toBe("foo");
    });
  });
});

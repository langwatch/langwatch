/**
 * @vitest-environment node
 *
 * "Opened pull request #1" is how Langy names a pull request, and the panel had
 * the number and no way through to it. The URL comes from the turn's tool
 * calls, never from the reply — a number Langy merely mentioned stays plain.
 *
 * @see specs/langy/langy-github-prs.feature
 */
import { describe, expect, it } from "vitest";
import {
  linkPullRequestReferences,
  pullRequestLinksFromToolParts,
} from "../logic/langyPullRequestLinks";

/** What `gh pr create` prints, as the local shell tool records it. */
const prCreateOutput = [
  "exit code: 0",
  "",
  "stdout:",
  "[langy/instrument b280b5c] feat: add LangWatch tracing",
  "https://github.com/acme/support-agent/pull/1",
].join("\n");

describe("pullRequestLinksFromToolParts", () => {
  describe("given a local shell call that opened a pull request", () => {
    it("reads the number and the URL out of its stdout", () => {
      const links = pullRequestLinksFromToolParts([
        {
          type: "tool-local_bash",
          state: "output-available",
          output: prCreateOutput,
        },
      ]);

      expect(links.get(1)).toBe("https://github.com/acme/support-agent/pull/1");
    });
  });

  describe("given the sandbox path's own receipt", () => {
    it("reads the pull request off the github.open_pr part", () => {
      const links = pullRequestLinksFromToolParts([
        {
          type: "tool-github.open_pr",
          state: "output-available",
          output: JSON.stringify({
            owner: "acme",
            repo: "support-agent",
            number: 7,
            url: "https://github.com/acme/support-agent/pull/7",
            state: "open",
          }),
        },
      ]);

      expect(links.get(7)).toBe("https://github.com/acme/support-agent/pull/7");
    });
  });

  describe("when the call that would have opened it failed", () => {
    it("finds no pull request", () => {
      const links = pullRequestLinksFromToolParts([
        {
          type: "tool-local_bash",
          state: "output-error",
          output: prCreateOutput,
        },
      ]);

      expect(links.size).toBe(0);
    });
  });
});

describe("linkPullRequestReferences", () => {
  const links = new Map([[1, "https://github.com/acme/support-agent/pull/1"]]);

  describe("given a reply that names a pull request the turn opened", () => {
    /** @scenario "A pull request number in the reply links to the pull request" */
    it("links the number", () => {
      expect(
        linkPullRequestReferences({
          text: "Opened pull request **#1** with the tracing changes.",
          links,
        }),
      ).toBe(
        "Opened pull request **[#1](https://github.com/acme/support-agent/pull/1)** with the tracing changes.",
      );
    });
  });

  describe("given a number with no pull request behind it", () => {
    /** @scenario "A number with no pull request behind it stays plain text" */
    it("leaves the text alone", () => {
      const text = "Ran #42 checks and they all passed.";

      expect(linkPullRequestReferences({ text, links })).toBe(text);
      expect(linkPullRequestReferences({ text, links: new Map() })).toBe(text);
    });
  });

  describe("given the number inside code", () => {
    it("never rewrites a code span or a fence", () => {
      const text = "Run `git show #1` first.\n\n```\nsee #1\n```\n";

      expect(linkPullRequestReferences({ text, links })).toBe(text);
    });
  });

  describe("given a URL fragment or a word ending in a hash", () => {
    it("only links a standalone reference", () => {
      const text = "See https://example.com/docs#1 and issue#1 for context.";

      expect(linkPullRequestReferences({ text, links })).toBe(text);
    });
  });
});

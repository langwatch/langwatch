/**
 * @vitest-environment node
 *
 * The PR card's data contract — and the death of the last prose dependency.
 *
 * The card used to be scraped from the assistant's reply: any
 * `github.com/owner/repo/pull/N` URL in the text drew one. So the model could
 * mangle the URL, omit it, or merely MENTION a PR it never opened and get a card
 * for it. It is now read from a `github.open_pr` TOOL PART the control plane
 * wrote from `gh pr create`'s own stdout.
 */
import { describe, expect, it } from "vitest";
import {
  githubPrsFromToolParts,
  LANGY_OPEN_PR_TOOL,
  parseGithubPrCard,
} from "../githubPrCard";

const RICH = {
  owner: "acme",
  repo: "checkout",
  number: 412,
  url: "https://github.com/acme/checkout/pull/412",
  state: "open",
  title: "Fix the retriever",
  headRef: "langy/fix",
  baseRef: "main",
  author: "octocat",
  additions: 38,
  deletions: 12,
  changedFiles: 3,
};

function toolPart(output: unknown, state = "output-available") {
  return { type: `tool-${LANGY_OPEN_PR_TOOL}`, state, output };
}

describe("parseGithubPrCard", () => {
  describe("given an enriched PR", () => {
    it("carries the whole rich shape through", () => {
      expect(parseGithubPrCard(JSON.stringify(RICH))).toEqual(RICH);
    });
  });

  describe("given a PR the GitHub lookup could not enrich", () => {
    it("keeps what stdout knew and omits the rest — no half-populated lie", () => {
      // Expired token / private repo / rate limit. None of that means "no PR",
      // so the card degrades to the identity, which stdout always gives us.
      const bare = {
        owner: "acme",
        repo: "checkout",
        number: 414,
        url: "https://github.com/acme/checkout/pull/414",
        state: "open",
      };
      const parsed = parseGithubPrCard(JSON.stringify(bare))!;
      expect(parsed).toEqual(bare);
      expect(parsed.title).toBeUndefined();
      expect(parsed.additions).toBeUndefined();
    });
  });

  describe("given output missing the PR's identity", () => {
    it("is not a card — stdout always gives us these four", () => {
      expect(parseGithubPrCard(JSON.stringify({ title: "no id" }))).toBeNull();
      expect(parseGithubPrCard("not json")).toBeNull();
      expect(parseGithubPrCard(undefined)).toBeNull();
    });
  });

  describe("given an unrecognised state", () => {
    it("falls back to open rather than rendering a state we invented", () => {
      expect(
        parseGithubPrCard(JSON.stringify({ ...RICH, state: "exploded" }))?.state,
      ).toBe("open");
    });
  });
});

describe("githubPrsFromToolParts", () => {
  describe("given a message whose turn opened a PR", () => {
    it("renders it from the tool part", () => {
      const prs = githubPrsFromToolParts([toolPart(JSON.stringify(RICH))]);
      expect(prs).toHaveLength(1);
      expect(prs[0]!.title).toBe("Fix the retriever");
    });

    it("does not double-render the same PR", () => {
      const prs = githubPrsFromToolParts([
        toolPart(JSON.stringify(RICH)),
        toolPart(JSON.stringify(RICH)),
      ]);
      expect(prs).toHaveLength(1);
    });
  });

  describe("given a gh pr create that FAILED", () => {
    it("renders no card — a PR that did not open must not look like one that did", () => {
      const prs = githubPrsFromToolParts([
        toolPart(JSON.stringify(RICH), "output-error"),
      ]);
      expect(prs).toEqual([]);
    });
  });

  describe("given a reply that merely TALKS about a pull request", () => {
    /** The regression the prose card shipped: a mention drew a card. */
    it("renders nothing — prose cannot produce a card any more", () => {
      const prs = githubPrsFromToolParts([
        {
          type: "text",
          output: undefined,
          // Even a perfectly-formed PR URL in the model's text is just text now.
        } as never,
        { type: "tool-bash", state: "output-available", output: "gh pr list" },
      ]);
      expect(prs).toEqual([]);
    });
  });
});

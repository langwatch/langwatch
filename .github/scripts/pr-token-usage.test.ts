import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MARKER,
  agentCell,
  agentLabel,
  buildCommentBody,
  formatCost,
  formatCount,
  humanizeCount,
  interpretUsageResponse,
  nextPageUrl,
  readPullRequestHead,
  type PullRequestUsage,
  type UsageRow,
} from "./pr-token-usage.ts";

const row = (overrides: Partial<UsageRow> = {}): UsageRow => ({
  projectSlug: "personal-abc",
  contributorLabel: "Ada Lovelace",
  contributorIsProject: false,
  agent: "claude_code",
  models: ["claude-fable-5"],
  sessionsCount: 2,
  inputTokens: 1_000,
  outputTokens: 2_000,
  cacheReadTokens: 30_000,
  cacheCreationTokens: 4_000,
  totalTokens: 37_000,
  costUsd: 12.5,
  ...overrides,
});

const usage = (overrides: Partial<PullRequestUsage> = {}): PullRequestUsage => ({
  rows: [row()],
  totals: {
    sessionsCount: 2,
    inputTokens: 1_000,
    outputTokens: 2_000,
    cacheReadTokens: 30_000,
    cacheCreationTokens: 4_000,
    totalTokens: 37_000,
    costUsd: 12.5,
  },
  modelBreakdown: [
    {
      model: "claude-fable-5",
      inputTokens: 1_000,
      outputTokens: 2_000,
      cacheReadTokens: 30_000,
      cacheCreationTokens: 4_000,
      totalTokens: 37_000,
      costUsd: 12.5,
    },
  ],
  ...overrides,
});

const build = (data: PullRequestUsage): string =>
  buildCommentBody({
    usage: data,
    shortSha: "abc1234",
    updatedAtIso: "2026-08-30T12:34:56.000Z",
  });

describe("given a usage rollup with rows for two contributors", () => {
  describe("when the comment body is built", () => {
    /** @scenario "The comment shows one row per contributor and agent" */
    it("renders each contributor once with agent, sessions, tokens and cost, and a totals row", () => {
      const body = build(
        usage({
          rows: [row(), row({ contributorLabel: "Grace Hopper", agent: "codex", costUsd: 3 })],
          totals: {
            sessionsCount: 4,
            inputTokens: 2_000,
            outputTokens: 4_000,
            cacheReadTokens: 60_000,
            cacheCreationTokens: 8_000,
            totalTokens: 74_000,
            costUsd: 15.5,
          },
        }),
      );
      assert.ok(body.startsWith(MARKER));
      assert.match(
        body,
        /\| Ada Lovelace \| <img [^|]+\/> Claude Code \| 2 \| 37 thousand \| \$12\.50 \|/,
      );
      assert.match(
        body,
        /\| Grace Hopper \| <img [^|]+\/> Codex \| 2 \| 37 thousand \| \$3\.00 \|/,
      );
      assert.match(
        body,
        /\| \*\*Total\*\* \|  \| \*\*4\*\* \| \*\*74 thousand\*\* \| \*\*\$15\.50\*\* \|/,
      );
    });
  });
});

describe("given a usage rollup with a model breakdown", () => {
  describe("when the comment body is built", () => {
    /** @scenario "The comment carries a per-model breakdown" */
    it("lists each model's tokens and cost inside a collapsed details section", () => {
      const body = build(usage());
      const detailsStart = body.indexOf("<details>");
      const detailsEnd = body.indexOf("</details>");
      assert.ok(detailsStart !== -1 && detailsEnd > detailsStart);
      const details = body.slice(detailsStart, detailsEnd);
      assert.match(details, /`claude-fable-5`/);
      assert.match(details, /\| 37 thousand \| \$12\.50 \|/);
    });
  });
});

describe("given a usage rollup whose cost fields are null", () => {
  describe("when the comment body is built", () => {
    /** @scenario "Costs the caller may not price render as unavailable" */
    it("renders the cost cells as an em dash rather than zero", () => {
      const body = build(
        usage({
          rows: [row({ costUsd: null })],
          totals: { ...usage().totals, costUsd: null },
        }),
      );
      assert.match(
        body,
        /\| Ada Lovelace \| <img [^|]+\/> Claude Code \| 2 \| 37 thousand \| — \|/,
      );
      assert.match(
        body,
        /\| \*\*Total\*\* \|  \| \*\*2\*\* \| \*\*37 thousand\*\* \| \*\*—\*\* \|/,
      );
      assert.ok(!body.includes("$0.00"));
    });
  });
});

describe("given a usage rollup with a token count above one billion", () => {
  describe("when the comment body is built", () => {
    /** @scenario "Token counts render as words" */
    it("renders the count as a spelled-out magnitude, never a letter abbreviation", () => {
      const big = 2_603_257_062;
      const body = build(
        usage({
          rows: [row({ totalTokens: big })],
          totals: { ...usage().totals, totalTokens: big },
        }),
      );
      assert.ok(body.includes("2.6 billion"));
      assert.ok(!body.includes("2,603,257,062"));
      assert.ok(!/\d(\.\d+)?[KMB]\b/.test(body));
    });
  });
});

describe("given the count humanizer", () => {
  it("picks the right word, keeps small counts plain, and promotes on round-up", () => {
    assert.equal(humanizeCount(0), "0");
    assert.equal(humanizeCount(999), "999");
    assert.equal(humanizeCount(37_000), "37 thousand");
    assert.equal(humanizeCount(156_800), "157 thousand");
    assert.equal(humanizeCount(1_888_045), "1.9 million");
    assert.equal(humanizeCount(2_603_257_062), "2.6 billion");
    assert.equal(humanizeCount(4_200_000_000_000), "4.2 trillion");
    assert.equal(humanizeCount(999_960), "1 million");
  });
});

describe("given a usage row's agent identifier", () => {
  describe("when the comment body is built", () => {
    /** @scenario "Agent identifiers render as product names with their icons" */
    it("renders known identifiers with their product icon and unknown ones readably without one", () => {
      assert.equal(agentLabel("claude_code"), "Claude Code");
      assert.equal(agentLabel("gemini_cli"), "Gemini CLI");
      assert.equal(
        agentCell("claude_code"),
        '<img src="https://app.langwatch.ai/images/external-icons/claude-code.svg" width="14" height="14" /> Claude Code',
      );
      assert.equal(
        agentCell("codex"),
        '<img src="https://app.langwatch.ai/images/external-icons/codex.svg" width="14" height="14" /> Codex',
      );
      assert.equal(agentCell("mystery_agent"), "Mystery Agent");
    });
  });
});

describe("given a usage rollup whose model rows cover far fewer tokens than the totals", () => {
  describe("when the comment body is built", () => {
    /** @scenario "A gap between session totals and per-model rows is called out" */
    it("states how many of the total tokens the model rows cover", () => {
      const body = build(
        usage({
          rows: [row({ totalTokens: 2_600_000_000 })],
          totals: { ...usage().totals, totalTokens: 2_600_000_000 },
          // modelBreakdown from the fixture covers only 37,000 tokens.
        }),
      );
      assert.match(
        body,
        /> The per-model rows cover 37 thousand of the 2\.6 billion total tokens\./,
      );
    });

    it("carries no note when the model rows match the totals", () => {
      const body = build(usage());
      assert.ok(!body.includes("per-model rows cover"));
    });
  });
});

describe("given the LangWatch API's answer", () => {
  describe("when the pull request is not mapped", () => {
    /** @scenario "An unmapped pull request reads as no usage" */
    it("treats the refusal as no usage recorded, in every error envelope shape", () => {
      // The v1 family's live shape: specific code beside generic status text.
      const v1Flat = interpretUsageResponse({
        status: 404,
        body: {
          code: "github_pr_not_mapped",
          message: "github_pr_not_mapped",
          error: "Not Found",
          kind: "github_pr_not_mapped",
        },
      });
      assert.equal(v1Flat.kind, "none");
      const canonical = interpretUsageResponse({
        status: 404,
        body: {
          error: {
            type: "not_found",
            code: "github_pr_not_mapped",
            message: "pull request not found",
          },
        },
      });
      assert.equal(canonical.kind, "none");
      const legacyFlat = interpretUsageResponse({
        status: 404,
        body: { error: "github_pr_not_mapped", message: "pull request not found" },
      });
      assert.equal(legacyFlat.kind, "none");
    });
  });

  describe("when the API answers with any other failure", () => {
    it("reads as an error naming the status and code", () => {
      const outcome = interpretUsageResponse({
        status: 401,
        body: { error: "invalid_credentials" },
      });
      assert.equal(outcome.kind, "error");
      assert.ok(outcome.kind === "error" && outcome.message.includes("401"));
      assert.ok(outcome.kind === "error" && outcome.message.includes("invalid_credentials"));
    });
  });

  describe("when the API answers 200", () => {
    it("passes the rollup through", () => {
      const outcome = interpretUsageResponse({ status: 200, body: usage() });
      assert.equal(outcome.kind, "usage");
    });
  });
});

describe("given a rollup with no sessions", () => {
  describe("when the comment body is built", () => {
    /** @scenario "An empty report says what to check" */
    it("says nothing was attributed and folds away what to check", () => {
      const body = build(
        usage({ rows: [], totals: { ...usage().totals, sessionsCount: 0 }, modelBreakdown: [] }),
      );
      assert.ok(body.includes("No coding agent usage was attributed"));
      assert.ok(!body.includes("| Contributor |"));
      // Folded, so an empty report costs one line until someone opens it.
      assert.match(body, /<details>\n<summary>If an agent did work here/);
      assert.ok(body.includes("</details>"));
      // The three things worth checking, in order.
      assert.ok(body.includes("langwatch instrument claude"));
      assert.ok(body.includes("langwatch ingest context"));
      assert.match(body, /worktree other than the one the session opened/);
    });

    it("carries no troubleshooting note when there is usage to show", () => {
      assert.ok(!build(usage()).includes("If an agent did work here"));
    });
  });
});

describe("given a pull request that has merged", () => {
  describe("when its comment is refreshed one last time", () => {
    /** @scenario "The last refresh says the number is settled" */
    it("stamps the comment as final at the merge commit", () => {
      const body = buildCommentBody({
        usage: usage(),
        shortSha: "9f8e7d6",
        updatedAtIso: "2026-09-01T09:00:00.000Z",
        final: true,
      });
      assert.match(body, /Final, at the merge of `9f8e7d6` · 2026-09-01 09:00 UTC/);
      assert.ok(!body.includes("Updated for"));
    });

    it("keeps the ordinary stamp while the pull request is open", () => {
      assert.match(build(usage()), /Updated for `abc1234`/);
      assert.ok(!build(usage()).includes("Final, at the merge"));
    });
  });
});

describe("given a comment listing that spans more pages than a fixed cap", () => {
  describe("when the next page is read from the Link header", () => {
    /** @scenario "The whole comment listing is searched for the marker" */
    it("follows rel=next until the listing ends", () => {
      assert.equal(
        nextPageUrl(
          '<https://api.github.com/repositories/1/issues/2/comments?page=12>; rel="next", ' +
            '<https://api.github.com/repositories/1/issues/2/comments?page=40>; rel="last"',
        ),
        "https://api.github.com/repositories/1/issues/2/comments?page=12",
      );
      // The last page carries prev and first, never next: that ends the walk.
      assert.equal(
        nextPageUrl(
          '<https://api.github.com/repositories/1/issues/2/comments?page=39>; rel="prev", ' +
            '<https://api.github.com/repositories/1/issues/2/comments?page=1>; rel="first"',
        ),
        null,
      );
      assert.equal(nextPageUrl(null), null);
    });
  });
});

describe("given a manual refresh, which names only a pull request number", () => {
  describe("when the pull request is read", () => {
    /** @scenario "A manual refresh reports the pull request's own head commit" */
    it("takes the head sha from the pull request, not from the dispatch ref", () => {
      const head = readPullRequestHead({
        repository: "acme/widgets",
        pullRequest: {
          head: { sha: "f00ba12345", repo: { full_name: "acme/widgets" } },
        },
      });
      assert.equal(head.headSha, "f00ba12345");
      assert.equal(head.isFork, false);
    });

    /** @scenario "A manual refresh still refuses a fork pull request" */
    it("reads a head branch from another repository as a fork", () => {
      assert.equal(
        readPullRequestHead({
          repository: "acme/widgets",
          pullRequest: {
            head: { sha: "f00ba12", repo: { full_name: "contributor/widgets" } },
          },
        }).isFork,
        true,
      );
      // A deleted fork leaves no head repository at all.
      assert.equal(
        readPullRequestHead({
          repository: "acme/widgets",
          pullRequest: { head: { sha: "f00ba12", repo: null } },
        }).isFork,
        true,
      );
    });
  });
});

describe("given the number and cost formatters", () => {
  it("formats counts and costs the way the tables promise", () => {
    assert.equal(formatCount(1234567), "1,234,567");
    assert.equal(formatCost(2076.492055), "$2,076.49");
    assert.equal(formatCost(null), "—");
  });
});

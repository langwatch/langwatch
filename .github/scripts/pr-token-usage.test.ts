import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MARKER,
  agentLabel,
  buildCommentBody,
  formatCost,
  formatCount,
  interpretUsageResponse,
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
          rows: [
            row(),
            row({ contributorLabel: "Grace Hopper", agent: "codex", costUsd: 3 }),
          ],
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
      assert.match(body, /\| Ada Lovelace \| Claude Code \| 2 \| 37,000 \| \$12\.50 \|/);
      assert.match(body, /\| Grace Hopper \| Codex \| 2 \| 37,000 \| \$3\.00 \|/);
      assert.match(body, /\| \*\*Total\*\* \|  \| \*\*4\*\* \| \*\*74,000\*\* \| \*\*\$15\.50\*\* \|/);
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
      assert.match(details, /\| 37,000 \| \$12\.50 \|/);
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
      assert.match(body, /\| Ada Lovelace \| Claude Code \| 2 \| 37,000 \| — \|/);
      assert.match(body, /\| \*\*Total\*\* \|  \| \*\*2\*\* \| \*\*37,000\*\* \| \*\*—\*\* \|/);
      assert.ok(!body.includes("$0.00"));
    });
  });
});

describe("given a usage rollup with a token count above one billion", () => {
  describe("when the comment body is built", () => {
    /** @scenario "Token counts are written in full with thousands separators" */
    it("writes the count in full with separators, never abbreviated", () => {
      const big = 2_603_257_062;
      const body = build(
        usage({
          rows: [row({ totalTokens: big })],
          totals: { ...usage().totals, totalTokens: big },
        }),
      );
      assert.ok(body.includes("2,603,257,062"));
      assert.ok(!/\d(\.\d+)?[KMB]\b/.test(body));
    });
  });
});

describe("given a usage row's agent identifier", () => {
  describe("when the comment body is built", () => {
    /** @scenario "Agent identifiers render as product names" */
    it("renders known identifiers as product names and unknown ones readably", () => {
      assert.equal(agentLabel("claude_code"), "Claude Code");
      assert.equal(agentLabel("opencode"), "OpenCode");
      assert.equal(agentLabel("gemini_cli"), "Gemini CLI");
      assert.equal(agentLabel("mystery_agent"), "Mystery Agent");
    });
  });
});

describe("given the LangWatch API's answer", () => {
  describe("when the pull request is not mapped", () => {
    /** @scenario "An unmapped pull request reads as no usage" */
    it("treats the refusal as no usage recorded rather than an error", () => {
      const outcome = interpretUsageResponse({
        status: 404,
        body: { error: "github_pr_not_mapped", message: "pull request not found" },
      });
      assert.equal(outcome.kind, "none");
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
      assert.ok(
        outcome.kind === "error" && outcome.message.includes("invalid_credentials"),
      );
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
  describe("when the comment body is built anyway (an existing comment is refreshed)", () => {
    it("states that no sessions are recorded instead of an empty table", () => {
      const body = build(
        usage({ rows: [], totals: { ...usage().totals, sessionsCount: 0 }, modelBreakdown: [] }),
      );
      assert.ok(body.includes("No coding agent sessions recorded"));
      assert.ok(!body.includes("| Contributor |"));
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

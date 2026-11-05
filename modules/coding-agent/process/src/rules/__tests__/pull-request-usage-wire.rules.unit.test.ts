/**
 * @vitest-environment node
 * @unit
 * The REST door returns the parsed output, so a field the wire shape leaves out
 * never reaches a caller.
 * @see specs/coding-agent/copilot-sessions.feature
 */
import { describe, expect, it } from "vitest";

import { pullRequestUsageResponseSchema } from "../pull-request-usage-wire.rules.ts";

const totals = {
  sessionsCount: 1,
  inputTokens: 1200,
  outputTokens: 300,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  totalTokens: 1500,
  costUsd: 0.02,
  billedCostUsd: 0.02,
  nonBilledCostUsd: 0,
};

function usageResponse() {
  return {
    pullRequest: {
      repositoryHost: "github.com",
      repositoryFullName: "acme/widgets",
      prNumber: 42,
      headBranch: "feat/widgets",
      htmlUrl: "https://github.com/acme/widgets/pull/42",
      state: "open",
      isDraft: false,
      authorLogin: "octocat",
      prCreatedAtMs: 1_700_000_000_000,
      prClosedAtMs: null,
      prMergedAtMs: null,
    },
    rows: [],
    totals,
    modelBreakdown: [
      {
        model: "gpt-5",
        inputTokens: 1200,
        outputTokens: 300,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        totalTokens: 1500,
        costUsd: 0.02,
        tokensKnown: true,
        aiUnits: 3,
      },
    ],
  };
}

describe("the pull-request usage wire shape", () => {
  describe("given a Copilot model that consumed AI units", () => {
    /** @scenario "AI units are their own count and never enter the dollar total" */
    it("returns the AI units as a count beside the model's dollar cost", () => {
      const parsed = pullRequestUsageResponseSchema.parse(usageResponse());

      expect(parsed.modelBreakdown[0]).toMatchObject({ aiUnits: 3, costUsd: 0.02 });
    });
  });
});

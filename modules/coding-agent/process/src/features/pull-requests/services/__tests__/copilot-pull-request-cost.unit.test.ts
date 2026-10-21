/**
 * @unit
 * @see specs/coding-agent/copilot-sessions.feature
 * @see specs/coding-agent/pull-request-linkage.feature
 */
import type {
  CodingAgentSessionContextUsage,
  CodingAgentSessionModelUsage,
} from "@langwatch/coding-agent-contract";
import { describe, expect, it } from "vitest";

import {
  TEST_NOW_MS,
  TestBillingPolicy,
  TestClock,
  TestEvents,
  TestGithubService,
  TestMetricSeries,
  createTestProjects,
  TestSessions,
  TestTraceSessions,
  branchSession,
  pullRequest,
} from "../../../../__tests__/fixtures/coding-agent.fixture.ts";
import { CodingAgentFeatureService } from "../../../../services/coding-agent.service.ts";

const DAY = 24 * 60 * 60 * 1000;
const PRICED_MODEL = "gpt-6-luna";
const UNPRICED_MODEL = "oswe-vscode-prime";

const query = {
  organizationId: "organization-1",
  repositoryHost: "github.com",
  repositoryFullName: "acme/widgets",
  prNumber: 8,
  permittedProjectIds: ["project-1"],
  costProjectIds: ["project-1"],
  projects: {
    "project-1": { slug: "personal", contributorLabel: "Ada", isLinkable: false },
  },
};

const unstamped = { repositoryHost: "", repositoryOwner: "", repositoryName: "", branch: "" };

function modelUsage(over: Partial<CodingAgentSessionModelUsage>): CodingAgentSessionModelUsage {
  return {
    ...unstamped,
    model: PRICED_MODEL,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    costUsd: 0,
    aiUnits: 0,
    priced: true,
    ...over,
  };
}

/** A Copilot session on the pull request's branch that called a priced and an unpriced model. */
function copilotSession() {
  return branchSession({
    sessionId: "copilot-1",
    agent: "copilot",
    gitBranch: "feature",
    models: [PRICED_MODEL, UNPRICED_MODEL],
    startedAtMs: TEST_NOW_MS - 2 * DAY,
    inputTokens: 16,
    outputTokens: 88,
    cacheReadTokens: 17039,
    cacheCreationTokens: 17039,
    costUsd: 0.002,
    usageByModel: [
      modelUsage({
        model: PRICED_MODEL,
        inputTokens: 3,
        outputTokens: 38,
        cacheCreationTokens: 17039,
        costUsd: 0.002,
        aiUnits: 7,
      }),
      modelUsage({
        model: UNPRICED_MODEL,
        inputTokens: 13,
        outputTokens: 50,
        cacheReadTokens: 17039,
        aiUnits: 5,
        priced: false,
      }),
    ],
  });
}

function serviceWith({ sessions, events }: { sessions: TestSessions; events?: TestEvents }) {
  const github = new TestGithubService();
  github.pullRequests = [
    pullRequest({
      repositoryFullName: query.repositoryFullName,
      headBranch: "feature",
      prNumber: query.prNumber,
      prCreatedAt: new Date(TEST_NOW_MS - 10 * DAY),
    }),
    pullRequest({
      repositoryFullName: query.repositoryFullName,
      headBranch: "other",
      prNumber: 9,
      prCreatedAt: new Date(TEST_NOW_MS - 10 * DAY),
    }),
  ];
  return CodingAgentFeatureService.create({
    sessions,
    traceSessions: new TestTraceSessions(),
    metricSeries: new TestMetricSeries(),
    sessionEvents: events ?? new TestEvents(),
    github,
    projects: createTestProjects(),
    billing: new TestBillingPolicy(),
    clock: new TestClock(),
  });
}

describe("Copilot pull-request cost", () => {
  describe("given a pull request fed by one Copilot session that used two models", () => {
    describe("when its usage is read", () => {
      /** @scenario "Each Copilot model on a pull request has known tokens" */
      it("shows each model's own known token counts", async () => {
        const sessions = new TestSessions();
        sessions.branchRows = [copilotSession()];

        const result = await serviceWith({ sessions }).getPullRequestUsage(query);

        expect(
          result.modelBreakdown.map(({ model, tokensKnown, inputTokens, outputTokens }) => ({
            model,
            tokensKnown,
            inputTokens,
            outputTokens,
          })),
        ).toEqual([
          { model: UNPRICED_MODEL, tokensKnown: true, inputTokens: 13, outputTokens: 50 },
          { model: PRICED_MODEL, tokensKnown: true, inputTokens: 3, outputTokens: 38 },
        ]);
      });

      /** @scenario "Each Copilot model on a pull request has known tokens" */
      it("shows only the tokens each model spent on this pull request's branch", async () => {
        const feature = { ...unstamped, repositoryHost: "github.com" };
        const stamp = (branch: string) => ({
          ...feature,
          repositoryOwner: "acme",
          repositoryName: "widgets",
          branch,
        });
        const context = (branch: string, tokens: number): CodingAgentSessionContextUsage => ({
          ...stamp(branch),
          inputTokens: tokens,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          costUsd: 0,
        });
        const sessions = new TestSessions();
        sessions.branchRows = [
          branchSession({
            sessionId: "copilot-2",
            agent: "copilot",
            gitBranch: "other",
            gitBranches: ["feature", "other"],
            models: [PRICED_MODEL, UNPRICED_MODEL],
            startedAtMs: TEST_NOW_MS - 2 * DAY,
            inputTokens: 300,
            usageByContext: [context("feature", 100), context("other", 200)],
            usageByModel: [
              modelUsage({ ...stamp("feature"), model: PRICED_MODEL, inputTokens: 100 }),
              modelUsage({ ...stamp("other"), model: UNPRICED_MODEL, inputTokens: 200 }),
            ],
          }),
        ];

        const result = await serviceWith({ sessions }).getPullRequestUsage(query);

        expect(result.totals.inputTokens).toBe(100);
        expect(
          result.modelBreakdown.map(({ model, inputTokens }) => ({ model, inputTokens })),
        ).toEqual([{ model: PRICED_MODEL, inputTokens: 100 }]);
      });
    });
  });

  describe("given a Copilot session that consumed AI units", () => {
    describe("when the pull request cost is shown", () => {
      /** @scenario "AI units are their own count and never enter the dollar total" */
      it("shows the AI units as a count and leaves them out of every dollar figure", async () => {
        const sessions = new TestSessions();
        sessions.branchRows = [copilotSession()];

        const detail = await serviceWith({ sessions }).getPullRequestDetail(query);

        expect(detail.modelBreakdown.map(({ model, aiUnits }) => ({ model, aiUnits }))).toEqual([
          { model: UNPRICED_MODEL, aiUnits: 5 },
          { model: PRICED_MODEL, aiUnits: 7 },
        ]);
        expect(detail.totals.costUsd).toBeCloseTo(0.002, 9);
        expect(detail.contributors[0]?.costUsd).toBeCloseTo(0.002, 9);
        expect(detail.sessions[0]?.costUsd).toBeCloseTo(0.002, 9);
        expect(detail.modelBreakdown.find((each) => each.model === PRICED_MODEL)?.costUsd).toBe(
          0.002,
        );
      });
    });
  });

  describe("given a Copilot model call on a model with no price", () => {
    describe("when the pull request cost is shown", () => {
      /** @scenario "A model with no price shows its tokens and an unknown cost" */
      it("shows its tokens and an unknown cost, not zero", async () => {
        const sessions = new TestSessions();
        sessions.branchRows = [copilotSession()];

        const result = await serviceWith({ sessions }).getPullRequestUsage(query);

        expect(result.modelBreakdown.find((each) => each.model === UNPRICED_MODEL)).toEqual({
          model: UNPRICED_MODEL,
          inputTokens: 13,
          outputTokens: 50,
          cacheReadTokens: 17039,
          cacheCreationTokens: 0,
          totalTokens: 17102,
          costUsd: null,
          tokensKnown: true,
          aiUnits: 5,
        });
      });
    });
  });

  describe("given Claude Code and Codex sessions on the same pull request as a Copilot one", () => {
    const claude = branchSession({
      sessionId: "claude-1",
      agent: "claude_code",
      gitBranch: "feature",
      models: ["claude-opus-5"],
      startedAtMs: TEST_NOW_MS - 3 * DAY,
      inputTokens: 10,
      outputTokens: 20,
      costUsd: 1.5,
    });
    const codex = branchSession({
      sessionId: "codex-1",
      agent: "codex",
      gitBranch: "feature",
      models: ["gpt-5-codex"],
      startedAtMs: TEST_NOW_MS - 3 * DAY,
      inputTokens: 40,
      outputTokens: 2,
      costUsd: 0.25,
    });
    const claudeEvents = () => {
      const events = new TestEvents();
      events.modelTotals = [
        {
          ...unstamped,
          tenantId: "project-1",
          sessionId: "claude-1",
          model: "claude-opus-5",
          inputTokens: 10,
          outputTokens: 20,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          costUsd: 1.5,
        },
      ];
      return events;
    };

    describe("when the pull request usage is read", () => {
      /** @scenario "Claude Code and Codex rows are unchanged by the Copilot declarations" */
      it("keeps the Claude Code and Codex rows and their per-call model as before", async () => {
        const sessions = new TestSessions();
        sessions.branchRows = [claude, codex];
        const before = await serviceWith({ sessions, events: claudeEvents() }).getPullRequestUsage(
          query,
        );
        sessions.branchRows = [claude, codex, copilotSession()];

        const after = await serviceWith({ sessions, events: claudeEvents() }).getPullRequestUsage(
          query,
        );

        const byAgent = (rows: typeof after.rows, agent: string) =>
          rows.find((row) => row.agent === agent);
        expect(byAgent(after.rows, "claude_code")).toEqual(byAgent(before.rows, "claude_code"));
        expect(byAgent(after.rows, "codex")).toEqual(byAgent(before.rows, "codex"));
        expect(byAgent(after.rows, "claude_code")).toMatchObject({ totalTokens: 30, costUsd: 1.5 });
        expect(byAgent(after.rows, "codex")).toMatchObject({ totalTokens: 42, costUsd: 0.25 });
        expect(after.totals.costUsd).toBeCloseTo(1.5 + 0.25 + 0.002, 9);
        expect(after.modelBreakdown.find((each) => each.model === "claude-opus-5")).toEqual(
          before.modelBreakdown.find((each) => each.model === "claude-opus-5"),
        );
      });

      /** @scenario "A session without per-call data still names its models beside one that has them" */
      it("still names the Codex model it has no per-call record for", async () => {
        const sessions = new TestSessions();
        sessions.branchRows = [codex, copilotSession()];

        const result = await serviceWith({ sessions }).getPullRequestUsage(query);

        expect(result.modelBreakdown.map(({ model }) => model)).toEqual([
          UNPRICED_MODEL,
          PRICED_MODEL,
          "gpt-5-codex",
        ]);
        expect(result.modelBreakdown.find((each) => each.model === "gpt-5-codex")).toMatchObject({
          tokensKnown: false,
          totalTokens: 0,
          costUsd: null,
          aiUnits: 0,
        });
        expect(result.totals).toMatchObject({ inputTokens: 40 + 16, outputTokens: 2 + 88 });
        expect(result.totals.costUsd).toBeCloseTo(0.25 + 0.002, 9);
      });
    });
  });
});

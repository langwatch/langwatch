/**
 * Stand-in reads for the activity ops functions: coding agent sessions, gateway spend, Instant
 * Eval runs, scenario runs and browser sessions, each recording which project ids it was asked.
 * @see modules/staff-access/specs/staff-access-functions-activity.feature
 */
import type { AuthApi } from "@langwatch/auth-contract";
import type { CodingAgentApi } from "@langwatch/coding-agent-contract";
import type { GatewayApi } from "@langwatch/gateway-contract";
import type { InstantEvalApi } from "@langwatch/instant-eval-contract";
import type { ScenarioApi } from "@langwatch/scenario-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";

export type ActivityAsk = Readonly<{ read: string; projectIds: readonly string[] }>;

const NOV_1 = Date.parse("2026-11-01T00:00:00Z");
const OCT_28 = Date.parse("2026-10-28T00:00:00Z");
const OCT_29 = Date.parse("2026-10-29T00:00:00Z");

export const activityPeers = {
  codingAgents: (asks: ActivityAsk[]): Pick<CodingAgentApi, "findDailySessionCounts"> => ({
    findDailySessionCounts: async ({ projectIds }) => {
      asks.push({ read: "coding_agents", projectIds });
      return projectIds.flatMap((projectId) => [
        { projectId, day: NOV_1, agent: "claude_code", sessions: 3, users: 2 },
        { projectId, day: NOV_1, agent: "Weird Agent (ACME build)", sessions: 1, users: 1 },
      ]);
    },
  }),
  gateway: (asks: ActivityAsk[]): Pick<GatewayApi, "findDailyKeySpend"> => ({
    findDailyKeySpend: async ({ projectIds }) => {
      asks.push({ read: "gateway", projectIds });
      return projectIds.map((projectId) => ({
        projectId,
        day: NOV_1,
        virtualKeyId: "vk_1",
        providerId: "provider_1",
        requests: 10,
        failedRequests: 1,
        spendUsd: 0.25,
      }));
    },
  }),
  auth: (): Pick<AuthApi, "findSessionUsersSince"> => ({
    findSessionUsersSince: async ({ userIds }) => userIds.slice(0, 1),
  }),
  instantEvals: (asks: ActivityAsk[]): InstantEvalApi =>
    createApiFixture<InstantEvalApi>({
      findDailyRunCounts: async ({ projectIds }) => {
        asks.push({ read: "instant_evals", projectIds });
        return projectIds.flatMap((projectId) => [
          {
            projectId,
            day: OCT_28,
            runs: 1,
            judgedRows: 400,
            largestRun: 500,
            failedRuns: 1,
            failedByCode: [{ code: "instant_eval_budget_exhausted", count: 1 }],
            priceUsd: 0.1,
            lastRunAt: OCT_28 + 3_600_000,
          },
          {
            projectId,
            day: OCT_29,
            runs: 2,
            judgedRows: 1000,
            largestRun: 800,
            failedRuns: 1,
            failedByCode: [{ code: "Judge said: the ACME prompt was rude", count: 1 }],
            priceUsd: 0.2,
            lastRunAt: OCT_29 + 7_200_000,
          },
        ]);
      },
    }),
  scenarios: (asks: ActivityAsk[], ranIn: readonly string[]): ScenarioApi =>
    createApiFixture<ScenarioApi>({
      findRunCountsByProject: async ({ projectIds }) => {
        asks.push({ read: "scenarios", projectIds });
        return projectIds
          .filter((projectId) =>
            ranIn.some((organizationId) => projectId.startsWith(organizationId)),
          )
          .map((projectId) => ({ projectId, runs: 5, suites: 2, failedRuns: 1 }));
      },
    }),
};

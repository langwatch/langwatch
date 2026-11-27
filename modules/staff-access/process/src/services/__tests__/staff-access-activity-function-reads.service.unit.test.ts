/** @see modules/staff-access/specs/staff-access-functions-activity.feature */
import type { AuthApi } from "@langwatch/auth-contract";
import type { CodingAgentApi } from "@langwatch/coding-agent-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { EvaluationApi } from "@langwatch/evaluation-contract";
import type { GatewayApi } from "@langwatch/gateway-contract";
import type { InstantEvalApi } from "@langwatch/instant-eval-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { ScenarioApi } from "@langwatch/scenario-contract";
import { STAFF_ACCESS_FUNCTION_LIMITS } from "@langwatch/staff-access-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import type { TraceApi } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { DAY_MS } from "../../rules/staff-access-function.rules.ts";
import { StaffAccessActivityFunctionReadsService } from "../staff-access-activity-function-reads.service.ts";

const AT = Temporal.Instant.from("2026-11-04T10:00:00Z");
const DAY = Date.parse("2026-11-02T00:00:00Z");
const PROJECT = "acme_project";

type Span = { since: number; until: number };

function readsOver({
  codingAgents,
  spans = [],
}: {
  codingAgents?: Pick<CodingAgentApi, "findDailySessionCounts">;
  spans?: Span[];
}) {
  const record = ({ since, until }: Span) => {
    spans.push({ since, until });
    return Promise.resolve([]);
  };
  return StaffAccessActivityFunctionReadsService.create({
    organizations: createApiFixture<OrganizationApi>({ getAllMembers: async () => [] }),
    projects: createApiFixture<ProjectApi>({ listIdsByOrganization: async () => [PROJECT] }),
    codingAgents:
      codingAgents ?? createApiFixture<CodingAgentApi>({ findDailySessionCounts: record }),
    gateway: createApiFixture<GatewayApi>({ findDailyKeySpend: record }),
    instantEvals: createApiFixture<InstantEvalApi>({ findDailyRunCounts: record }),
    traces: createApiFixture<TraceApi>({ countIngestionByProject: async () => [] }),
    evaluations: createApiFixture<EvaluationApi>({ countEvaluatorOutcomes: async () => [] }),
    scenarios: createApiFixture<ScenarioApi>({ findRunCountsByProject: async () => [] }),
    auth: createApiFixture<AuthApi>({}),
    entitlements: createApiFixture<EntitlementApi>({}),
  }).reads;
}

describe("the activity ops function reads", () => {
  describe("when two agent kinds both read as other on one project and day", () => {
    /** @scenario "org.coding_agents keeps two agent kinds that both read as other in their own rows" */
    it("answers one other row per kind with its own distinct users", async () => {
      const reads = readsOver({
        codingAgents: createApiFixture<CodingAgentApi>({
          findDailySessionCounts: async () => [
            { projectId: PROJECT, day: DAY, agent: "ACME Agent", sessions: 3, users: 2 },
            { projectId: PROJECT, day: DAY, agent: "Other/Agent", sessions: 4, users: 2 },
            { projectId: PROJECT, day: DAY, agent: "claude_code", sessions: 5, users: 3 },
          ],
        }),
      });

      const answered = await reads["org.coding_agents"]({
        input: { since: "2026-10-28T10:00:00Z" },
        organizationId: "acme",
        at: AT,
      });

      expect(answered.total).toBe(3);
      expect(
        answered.items
          .map(({ agent, sessions, users }) => ({ agent, sessions, users }))
          .toSorted((a, b) => a.sessions - b.sessions),
      ).toEqual([
        { agent: "other", sessions: 3, users: 2 },
        { agent: "other", sessions: 4, users: 2 },
        { agent: "claude_code", sessions: 5, users: 3 },
      ]);
    });
  });

  describe("when more weeks are asked for than one range holds", () => {
    /** @scenario "org.activity_weekly reads its daily figures in spans within the range limit" */
    it("answers every week and keeps each daily read within the range limit", async () => {
      const spans: Span[] = [];
      const reads = readsOver({ spans });

      const answered = await reads["org.activity_weekly"]({
        input: { weeks: 9 },
        organizationId: "acme",
        at: AT,
      });

      expect(answered.items).toHaveLength(9);
      expect(spans).toHaveLength(9);
      for (const span of spans) {
        expect(span.until - span.since).toBeLessThanOrEqual(
          STAFF_ACCESS_FUNCTION_LIMITS.maxRangeDays * DAY_MS,
        );
      }
      const weeks = answered.items.map((row) => Date.parse(row.week));
      expect(Math.min(...spans.map((span) => span.since))).toBe(weeks[0]);
      expect(Math.max(...spans.map((span) => span.until))).toBe((weeks.at(-1) ?? 0) + 7 * DAY_MS);
    });
  });
});

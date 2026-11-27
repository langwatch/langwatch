import type { AuthApi } from "@langwatch/auth-contract";
import type { CodingAgentApi } from "@langwatch/coding-agent-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { EvaluationApi } from "@langwatch/evaluation-contract";
import type { GatewayApi } from "@langwatch/gateway-contract";
import type { InstantEvalApi } from "@langwatch/instant-eval-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { ScenarioApi } from "@langwatch/scenario-contract";
import type {
  STAFF_ACCESS_ACTIVITY_FUNCTIONS,
  StaffAccessFunctionInput,
  StaffAccessFunctionOutput,
} from "@langwatch/staff-access-contract";
import type { Instant } from "@langwatch/time";
import type { TraceApi } from "@langwatch/trace-contract";

import {
  foldInstantEvalWeeks,
  plainCode,
  sumByWeek,
  WEEK_MS,
  weekStartsBack,
} from "../rules/staff-access-activity-function.rules.ts";
import { pageOf, rangeOf, isoOfMs, pageInputOf } from "../rules/staff-access-function.rules.ts";
import type { StaffAccessFunctionRuns } from "./staff-access-function-reads.service.ts";

type ActivityReadsDeps = Readonly<{
  organizations: Pick<OrganizationApi, "listProvisioningSummaries" | "getAllMembers">;
  projects: Pick<ProjectApi, "listIdsByOrganization">;
  codingAgents: Pick<CodingAgentApi, "findDailySessionCounts">;
  gateway: Pick<GatewayApi, "findDailyKeySpend">;
  instantEvals: Pick<InstantEvalApi, "findDailyRunCounts">;
  traces: Pick<TraceApi, "countIngestionByProject">;
  evaluations: Pick<EvaluationApi, "countEvaluatorOutcomes">;
  scenarios: Pick<ScenarioApi, "findRunCountsByProject">;
  auth: Pick<AuthApi, "findSessionUsersSince">;
  entitlements: Pick<EntitlementApi, "getUsageLimits">;
}>;

type Name = keyof typeof STAFF_ACCESS_ACTIVITY_FUNCTIONS;
type Call<N extends Name> = {
  input: StaffAccessFunctionInput<N>;
  organizationId: string;
  at: Instant;
};
type Window = { since: number; until: number };

/** Organizations read at once by `scenarios.runs_by_org`, so a platform read stays gentle. */
const ORGANIZATIONS_IN_FLIGHT = 8;

/** The activity ops functions' reads, each through the owning module's `*Api` (§3). */
export class StaffAccessActivityFunctionReadsService {
  readonly reads: StaffAccessFunctionRuns<Name>;

  private constructor(private readonly deps: ActivityReadsDeps) {
    this.reads = {
      "org.coding_agents": (call) => this.codingAgents(call),
      "org.gateway_spend": (call) => this.gatewaySpend(call),
      "org.instant_evals": (call) => this.instantEvals(call),
      "org.activity_weekly": (call) => this.activityWeekly(call),
      "scenarios.runs_by_org": (call) => this.scenarioRunsByOrganization(call),
    };
  }

  static create(deps: ActivityReadsDeps): StaffAccessActivityFunctionReadsService {
    return new StaffAccessActivityFunctionReadsService(deps);
  }

  private async codingAgents({
    input,
    organizationId,
    at,
  }: Call<"org.coding_agents">): Promise<StaffAccessFunctionOutput<"org.coding_agents">> {
    const window = windowOf({ input, at });
    const projectIds = await this.projectIdsOf({ organizationId });
    const counts = await this.deps.codingAgents.findDailySessionCounts({ projectIds, ...window });
    const merged = new Map<
      string,
      { day: number; projectId: string; agent: string; sessions: number; users: number }
    >();
    for (const count of counts) {
      const agent = plainCode(count.agent);
      const key = `${count.day}/${count.projectId}/${agent}`;
      const known = merged.get(key);
      merged.set(key, {
        day: count.day,
        projectId: count.projectId,
        agent,
        sessions: (known?.sessions ?? 0) + count.sessions,
        users: (known?.users ?? 0) + count.users,
      });
    }
    const rows = [...merged.values()].map((row) => ({ ...row, day: isoOfMs(row.day) }));
    return pageOf({
      rows,
      keyOf: (row) => `${row.day}/${row.projectId}/${row.agent}`,
      name: "org.coding_agents",
      ...pageInputOf(input),
    });
  }

  private async gatewaySpend({
    input,
    organizationId,
    at,
  }: Call<"org.gateway_spend">): Promise<StaffAccessFunctionOutput<"org.gateway_spend">> {
    const window = windowOf({ input, at });
    const projectIds = await this.projectIdsOf({ organizationId });
    const spend = await this.deps.gateway.findDailyKeySpend({ projectIds, ...window });
    const rows = spend.map((day) => ({
      day: isoOfMs(day.day),
      projectId: day.projectId,
      virtualKeyId: day.virtualKeyId,
      providerId: day.providerId,
      requests: day.requests,
      failedRequests: day.failedRequests,
      spendUsd: day.spendUsd,
    }));
    return pageOf({
      rows,
      keyOf: (row) => `${row.day}/${row.projectId}/${row.virtualKeyId}/${row.providerId}`,
      name: "org.gateway_spend",
      ...pageInputOf(input),
    });
  }

  private async instantEvals({
    input,
    organizationId,
    at,
  }: Call<"org.instant_evals">): Promise<StaffAccessFunctionOutput<"org.instant_evals">> {
    const window = windowOf({ input, at });
    const projectIds = await this.projectIdsOf({ organizationId });
    const days = await this.deps.instantEvals.findDailyRunCounts({ projectIds, ...window });
    const rows = foldInstantEvalWeeks(days);
    return pageOf({
      rows,
      keyOf: (row) => `${row.week}/${row.projectId}`,
      name: "org.instant_evals",
      ...pageInputOf(input),
    });
  }

  private async activityWeekly({
    input,
    organizationId,
    at,
  }: Call<"org.activity_weekly">): Promise<StaffAccessFunctionOutput<"org.activity_weekly">> {
    const starts = weekStartsBack({ weeks: input.weeks, at: at.epochMilliseconds });
    const span = { since: starts[0] ?? 0, until: (starts.at(-1) ?? 0) + WEEK_MS };
    const [projectIds, members] = await Promise.all([
      this.projectIdsOf({ organizationId }),
      this.deps.organizations.getAllMembers({ organizationId }),
    ]);
    const [agentDays, gatewayDays, instantDays] = await Promise.all([
      this.deps.codingAgents.findDailySessionCounts({ projectIds, ...span }),
      this.deps.gateway.findDailyKeySpend({ projectIds, ...span }),
      this.deps.instantEvals.findDailyRunCounts({ projectIds, ...span }),
    ]);
    const sessions = sumByWeek({
      rows: agentDays,
      dayOf: (row) => row.day,
      valueOf: (row) => row.sessions,
    });
    const requests = sumByWeek({
      rows: gatewayDays,
      dayOf: (row) => row.day,
      valueOf: (row) => row.requests,
    });
    const instantRuns = sumByWeek({
      rows: instantDays,
      dayOf: (row) => row.day,
      valueOf: (row) => row.runs,
    });
    const memberUserIds = members.map((member) => member.id);
    const rows = await Promise.all(
      starts.map(async (start) => ({
        week: isoOfMs(start),
        ...(await this.weekCounts({
          projectIds,
          memberUserIds,
          since: start,
          until: start + WEEK_MS,
        })),
        instantEvalRuns: instantRuns.get(start) ?? 0,
        codingAgentSessions: sessions.get(start) ?? 0,
        gatewayRequests: requests.get(start) ?? 0,
      })),
    );
    return pageOf({
      rows,
      keyOf: (row) => row.week,
      name: "org.activity_weekly",
      ...pageInputOf(input),
    });
  }

  /** The per-week reads that take a window rather than answering per day. */
  private async weekCounts({
    projectIds,
    memberUserIds,
    since,
    until,
  }: Window & { projectIds: string[]; memberUserIds: string[] }): Promise<{
    traces: number;
    evaluations: number;
    scenarioRuns: number;
    membersActiveSinceWeekStart: number;
  }> {
    const [traces, outcomes, scenarios, active] = await Promise.all([
      this.deps.traces.countIngestionByProject({ projectIds, since, until }),
      this.deps.evaluations.countEvaluatorOutcomes({ projectIds, since, until }),
      this.deps.scenarios.findRunCountsByProject({ projectIds, since, until }),
      memberUserIds.length === 0
        ? Promise.resolve([])
        : this.deps.auth.findSessionUsersSince({ userIds: memberUserIds, since }),
    ]);
    return {
      traces: traces.reduce((sum, row) => sum + row.traces, 0),
      evaluations: outcomes.reduce((sum, row) => sum + row.runs, 0),
      scenarioRuns: scenarios.reduce((sum, row) => sum + row.runs, 0),
      membersActiveSinceWeekStart: active.length,
    };
  }

  private async scenarioRunsByOrganization({
    input,
    at,
  }: Call<"scenarios.runs_by_org">): Promise<StaffAccessFunctionOutput<"scenarios.runs_by_org">> {
    const window = windowOf({ input, at });
    const organizations = await this.deps.organizations.listProvisioningSummaries();
    const rows: StaffAccessFunctionOutput<"scenarios.runs_by_org">["items"] = [];
    for (let index = 0; index < organizations.length; index += ORGANIZATIONS_IN_FLIGHT) {
      const batch = organizations.slice(index, index + ORGANIZATIONS_IN_FLIGHT);
      const counted = await Promise.all(
        batch.map((organization) =>
          this.organizationRuns({ organizationId: organization.id, window }),
        ),
      );
      rows.push(...counted.flat());
    }
    return pageOf({
      rows,
      keyOf: (row) => row.organizationId,
      name: "scenarios.runs_by_org",
      ...pageInputOf(input),
    });
  }

  /** One organization's scenario runs in the window; nothing when it ran none. */
  private async organizationRuns({
    organizationId,
    window,
  }: {
    organizationId: string;
    window: Window;
  }): Promise<StaffAccessFunctionOutput<"scenarios.runs_by_org">["items"]> {
    const projectIds = await this.projectIdsOf({ organizationId });
    if (projectIds.length === 0) return [];
    const counts = await this.deps.scenarios.findRunCountsByProject({ projectIds, ...window });
    const runs = counts.reduce((sum, count) => sum + count.runs, 0);
    if (runs === 0) return [];
    const { plan } = await this.deps.entitlements.getUsageLimits({ organizationId });
    return [
      {
        organizationId,
        plan,
        projects: counts.filter((count) => count.runs > 0).length,
        suites: counts.reduce((sum, count) => sum + count.suites, 0),
        runs,
        failedRuns: counts.reduce((sum, count) => sum + count.failedRuns, 0),
      },
    ];
  }

  private projectIdsOf({ organizationId }: { organizationId: string }): Promise<string[]> {
    return this.deps.projects.listIdsByOrganization({ organizationId });
  }
}

/** A ranged input's window in epoch milliseconds, through the 31-day range rule. */
function windowOf({
  input,
  at,
}: {
  input: { since: string; until?: string };
  at: Instant;
}): Window {
  const range = rangeOf({ since: input.since, ...(input.until ? { until: input.until } : {}), at });
  return { since: range.since.epochMilliseconds, until: range.until.epochMilliseconds };
}

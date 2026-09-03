/**
 * The App the v1 pull-request usage suites read through.
 *
 * Installed with a sessions store that answers one static session per project
 * THE READ IS PERMITTED TO ASK ABOUT (`listByRepositoryBranch` is called with
 * the resolved `permittedProjectIds`), which is what makes the key-ceiling cut
 * observable on the wire: a project outside the caller's scope contributes no
 * row because it was never read. The fixture itself is seeded by
 * pullRequestUsageV1Harness.ts.
 */
import { globalForApp } from "~/server/app-layer/app";
import { CodingAgentSessionService } from "~/server/app-layer/coding-agent/coding-agent-session.service";
import { CodingAgentSessionsListService } from "~/server/app-layer/coding-agent/coding-agent-sessions-list.service";
import { PullRequestUsageService } from "~/server/app-layer/coding-agent/pull-request-usage.service";
import {
  type CodingAgentBranchSessionRow,
  type CodingAgentSessionRepository,
  NullCodingAgentSessionRepository,
} from "~/server/app-layer/coding-agent/repositories/coding-agent-session.repository";
import { NullCodingAgentSessionEventsRepository } from "~/server/app-layer/coding-agent/repositories/coding-agent-session-events.repository";
import { NullCodingAgentTraceSessionRepository } from "~/server/app-layer/coding-agent/repositories/coding-agent-trace-session.repository";
import { NullSessionMetricSeriesRepository } from "~/server/app-layer/coding-agent/repositories/session-metric-series.repository";
import { GithubInstallationsService } from "~/server/app-layer/github/github-installations.service";
import { GithubAppTokenService } from "~/server/app-layer/github/githubAppToken";
import { NullGithubInstallationsRepository } from "~/server/app-layer/github/repositories/github-installations.repository";
import { PrismaGithubPullRequestsRepository } from "~/server/app-layer/github/repositories/github-pull-requests.prisma.repository";
import { createTestApp } from "~/server/app-layer/presets";
import { NullGithubPullRequestLookup } from "~/server/app-layer/traces/session-groups.pull-request-link";
import { prisma } from "~/server/db";
import type { PullRequestUsageV1Fixture } from "./pullRequestUsageV1Harness";

/**
 * A sessions store answering one static session per project asked about.
 * `listByRepositoryBranch` receives the caller's resolved
 * `permittedProjectIds` as `tenantIds`, so what comes back IS the scope cut.
 */
function staticBranchSessions(
  tenantIds: string[],
): CodingAgentSessionRepository {
  const base = new NullCodingAgentSessionRepository();
  return {
    upsert: base.upsert.bind(base),
    findBySessionId: base.findBySessionId.bind(base),
    findBySessionIdWithApplied: base.findBySessionIdWithApplied.bind(base),
    findManyRecent: base.findManyRecent.bind(base),
    listBySessionIds: base.listBySessionIds.bind(base),
    listByRepositoryBranch: async (params) =>
      tenantIds
        .filter((tenantId) => params.tenantIds.includes(tenantId))
        .map(
          (tenantId): CodingAgentBranchSessionRow => ({
            sessionId: `session-${tenantId}`,
            tenantId,
            startedAtMs: Date.now() - 60_000,
            lastEventOccurredAtMs: Date.now() - 30_000,
            inputTokens: 100,
            outputTokens: 50,
            cacheReadTokens: 10,
            cacheCreationTokens: 5,
            costUsd: 1.25,
            agent: "claude-code",
            models: ["gpt-5-mini"],
            userId: "agent-reported-user",
            gitBranch: "feat/linkage",
            gitBranches: ["feat/linkage"],
            title: "",
          }),
        ),
  };
}

/** Installs the App the routes read, with sessions for the two projects. */
export function installPullRequestUsageTestApp(
  fixture: PullRequestUsageV1Fixture,
): void {
  installPullRequestUsageTestAppForTenants({
    organizationId: fixture.organization.id,
    tenantIds: [fixture.projectAId, fixture.projectBId],
  });
}

/** The same App, for suites whose project set is not the two-project fixture. */
export function installPullRequestUsageTestAppForTenants({
  organizationId,
  tenantIds,
}: {
  organizationId: string;
  tenantIds: string[];
}): void {
  const staticSessions = staticBranchSessions(tenantIds);
  const nullSessionEvents = new NullCodingAgentSessionEventsRepository();
  const sessions = new CodingAgentSessionService({
    sessions: staticSessions,
    traceSessions: new NullCodingAgentTraceSessionRepository(),
    metricSeries: new NullSessionMetricSeriesRepository(),
    sessionEvents: nullSessionEvents,
  });
  globalForApp.__langwatch_app = createTestApp({
    codingAgents: {
      sessions,
      // The REST surface under test never reads it; the App's shape does.
      sessionsList: new CodingAgentSessionsListService({
        sessions,
        pullRequests: new NullGithubPullRequestLookup(),
        resolveOrganizationId: async () => organizationId,
      }),
      pullRequestUsage: new PullRequestUsageService({
        pullRequests: new PrismaGithubPullRequestsRepository(prisma),
        sessions: staticSessions,
        personalSessions: sessions,
        sessionEvents: nullSessionEvents,
        installations: new GithubInstallationsService(
          new NullGithubInstallationsRepository(),
          new GithubAppTokenService("", "", null),
        ),
        resolveOrganizationId: async () => organizationId,
        isSourceNonBillable: async () => false,
      }),
    },
  });
}

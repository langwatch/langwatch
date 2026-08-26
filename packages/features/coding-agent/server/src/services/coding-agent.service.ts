import {
  MAX_CODING_AGENT_SESSION_EVENTS_PAGE_SIZE,
  CodingAgentService as CodingAgentServiceContract,
  type CodingAgentPersonalPullRequestUsage,
  type CodingAgentPersonalPullRequestUsageInput,
  type CodingAgentPullRequestDetail,
  type CodingAgentPullRequestMappingBackfillInput,
  type CodingAgentPullRequestUsage,
  type CodingAgentPullRequestUsageInput,
  type CodingAgentRecentSessionsInput,
  type CodingAgentSession,
  type CodingAgentSessionCursor,
  type CodingAgentSessionEvent,
  type CodingAgentSessionEventsInput,
  type CodingAgentSessionListRow,
  type CodingAgentSessionLookupInput,
  type CodingAgentSessionsListInput,
  type CodingAgentTraceSessionLookupInput,
  type CodingAgentTracePullRequestInput,
  type CodingAgentTracePullRequestLink,
  type CodingAgentUsageTotals,
  type CodingAgentUsageTotalsInput,
} from "@langwatch/coding-agent-contract";
import type { GithubService } from "@langwatch/github-contract";
import type { ProjectService } from "@langwatch/project-contract";
import type { CodingAgentBillingPolicyPort } from "../ports/coding-agent-billing.port";
import type { CodingAgentClockPort } from "../ports/coding-agent-clock.port";
import { CodingAgentSessionEventRepository } from "../repositories/coding-agent-session-event.repository";
import { CodingAgentSessionRepository } from "../repositories/coding-agent-session.repository";
import { CodingAgentTraceSessionRepository } from "../repositories/coding-agent-trace-session.repository";
import { SessionMetricSeriesRepository } from "../repositories/session-metric-series.repository";
import { CodingAgentPersonalPullRequestValuesService } from "./coding-agent-personal-pull-request-values.service";
import { CodingAgentPullRequestAssignmentService } from "./coding-agent-pull-request-assignment.service";
import { CodingAgentPullRequestMappingBackfillService } from "./coding-agent-pull-request-mapping-backfill.service";
import { CodingAgentPullRequestReadService } from "./coding-agent-pull-request-read.service";
import { CodingAgentPullRequestUsageService } from "./coding-agent-pull-request-usage.service";
import { CodingAgentSessionListPullRequestService } from "./coding-agent-session-list-pull-request.service";
import { CodingAgentSessionReadService } from "./coding-agent-session-read.service";
import { CodingAgentTracePullRequestService } from "./coding-agent-trace-pull-request.service";

export const MAX_SESSION_EVENTS_PAGE_SIZE = MAX_CODING_AGENT_SESSION_EVENTS_PAGE_SIZE;

/** The one public Coding Agent contract, composed from private role-specific collaborators. */
export class CodingAgentFeatureService extends CodingAgentServiceContract {
  static create(options: {
    sessions: CodingAgentSessionRepository;
    traceSessions: CodingAgentTraceSessionRepository;
    metricSeries: SessionMetricSeriesRepository;
    sessionEvents: CodingAgentSessionEventRepository;
    github: GithubService;
    projects: ProjectService;
    billing: CodingAgentBillingPolicyPort;
    clock: CodingAgentClockPort;
  }): CodingAgentFeatureService {
    const sessionReads = CodingAgentSessionReadService.create({
      sessions: options.sessions,
      traceSessions: options.traceSessions,
      metricSeries: options.metricSeries,
      sessionEvents: options.sessionEvents,
      clock: options.clock,
    });
    const assignments = CodingAgentPullRequestAssignmentService.create();
    const usage = CodingAgentPullRequestUsageService.create();
    const personalValues = CodingAgentPersonalPullRequestValuesService.create({
      assignments,
      usage,
    });
    const sessionListPullRequests = CodingAgentSessionListPullRequestService.create({
      github: options.github,
      projects: options.projects,
      assignments,
    });
    const tracePullRequests = CodingAgentTracePullRequestService.create({
      github: options.github,
      assignments,
    });
    const pullRequestReads = CodingAgentPullRequestReadService.create({
      sessions: options.sessions,
      sessionEvents: options.sessionEvents,
      sessionReads,
      github: options.github,
      projects: options.projects,
      billing: options.billing,
      clock: options.clock,
      assignments,
      usage,
      personalValues,
      sessionListPullRequests,
    });
    const mappingBackfill = CodingAgentPullRequestMappingBackfillService.create({
      sessionReads,
      github: options.github,
      projects: options.projects,
      clock: options.clock,
    });
    return new CodingAgentFeatureService({
      sessionReads,
      pullRequestReads,
      mappingBackfill,
      tracePullRequests,
    });
  }

  private constructor(
    private readonly collaborators: {
      sessionReads: CodingAgentSessionReadService;
      pullRequestReads: CodingAgentPullRequestReadService;
      mappingBackfill: CodingAgentPullRequestMappingBackfillService;
      tracePullRequests: CodingAgentTracePullRequestService;
    },
  ) {
    super();
  }

  getSessionEvents(input: CodingAgentSessionEventsInput): Promise<{
    events: CodingAgentSessionEvent[];
    nextCursor: CodingAgentSessionCursor | null;
  }> {
    return this.collaborators.sessionReads.getSessionEvents(input);
  }

  tryGetBySessionId(
    input: CodingAgentSessionLookupInput,
  ): Promise<CodingAgentSession | null> {
    return this.collaborators.sessionReads.tryGetBySessionId(input);
  }

  tryGetSessionForTrace(
    input: CodingAgentTraceSessionLookupInput,
  ): Promise<CodingAgentSession | null> {
    return this.collaborators.sessionReads.tryGetSessionForTrace(input);
  }

  listRecent(input: CodingAgentRecentSessionsInput): Promise<CodingAgentSession[]> {
    return this.collaborators.sessionReads.listRecent(input);
  }

  backfillPullRequestMappings(
    input: CodingAgentPullRequestMappingBackfillInput,
  ): Promise<void> {
    return this.collaborators.mappingBackfill.backfill(input);
  }

  getUsageTotals(input: CodingAgentUsageTotalsInput): Promise<CodingAgentUsageTotals> {
    return this.collaborators.sessionReads.getUsageTotals(input);
  }

  listForProject(
    input: CodingAgentSessionsListInput,
  ): Promise<CodingAgentSessionListRow[]> {
    return this.collaborators.pullRequestReads.listForProject(input);
  }

  linkTraceSessionsToPullRequests(
    input: CodingAgentTracePullRequestInput,
  ): Promise<CodingAgentTracePullRequestLink[]> {
    return this.collaborators.tracePullRequests.link(input);
  }

  getPullRequestUsage(
    input: CodingAgentPullRequestUsageInput,
  ): Promise<CodingAgentPullRequestUsage> {
    return this.collaborators.pullRequestReads.getPullRequestUsage(input);
  }

  getPullRequestDetail(
    input: CodingAgentPullRequestUsageInput,
  ): Promise<CodingAgentPullRequestDetail> {
    return this.collaborators.pullRequestReads.getPullRequestDetail(input);
  }

  getForPersonalProject(
    input: CodingAgentPersonalPullRequestUsageInput,
  ): Promise<CodingAgentPersonalPullRequestUsage> {
    return this.collaborators.pullRequestReads.getForPersonalProject(input);
  }
}

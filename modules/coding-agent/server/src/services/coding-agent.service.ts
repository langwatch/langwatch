import {
  MAX_CODING_AGENT_SESSION_EVENTS_PAGE_SIZE,
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
import type { GithubApi } from "@langwatch/github-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { CodingAgentBillingPolicyPort } from "../ports/coding-agent-billing.port.ts";
import type { CodingAgentClockPort } from "../ports/coding-agent-clock.port.ts";
import { CodingAgentSessionEventRepository } from "../repositories/coding-agent-session-event.repository.ts";
import { CodingAgentSessionRepository } from "../repositories/coding-agent-session.repository.ts";
import { CodingAgentTraceSessionRepository } from "../repositories/coding-agent-trace-session.repository.ts";
import { SessionMetricSeriesRepository } from "../repositories/session-metric-series.repository.ts";
import { CodingAgentPersonalPullRequestValuesService } from "./coding-agent-personal-pull-request-values.service.ts";
import { CodingAgentPullRequestAssignmentService } from "./coding-agent-pull-request-assignment.service.ts";
import { CodingAgentPullRequestShareService } from "./coding-agent-pull-request-share.service.ts";
import { CodingAgentPullRequestMappingBackfillService } from "./coding-agent-pull-request-mapping-backfill.service.ts";
import { CodingAgentPullRequestReadService } from "./coding-agent-pull-request-read.service.ts";
import { CodingAgentPullRequestUsageService } from "./coding-agent-pull-request-usage.service.ts";
import { CodingAgentSessionListPullRequestService } from "./coding-agent-session-list-pull-request.service.ts";
import { CodingAgentSessionReadService } from "./coding-agent-session-read.service.ts";
import { CodingAgentTracePullRequestService } from "./coding-agent-trace-pull-request.service.ts";

export const MAX_SESSION_EVENTS_PAGE_SIZE = MAX_CODING_AGENT_SESSION_EVENTS_PAGE_SIZE;

/**
 * The session-aggregate capability `CodingAgentApp` composes over: private to this
 * package, narrower than the public `CodingAgentApi` (no viewer-scoped params, no
 * pure derivations `CodingAgentApp` answers itself).
 */
export interface CodingAgentSessionService {
  getSessionEvents(input: CodingAgentSessionEventsInput): Promise<{
    events: CodingAgentSessionEvent[];
    nextCursor: CodingAgentSessionCursor | null;
  }>;
  findBySessionId(input: CodingAgentSessionLookupInput): Promise<CodingAgentSession | null>;
  findSessionForTrace(
    input: CodingAgentTraceSessionLookupInput,
  ): Promise<CodingAgentSession | null>;
  listRecent(input: CodingAgentRecentSessionsInput): Promise<CodingAgentSession[]>;
  backfillPullRequestMappings(input: CodingAgentPullRequestMappingBackfillInput): Promise<void>;
  getUsageTotals(input: CodingAgentUsageTotalsInput): Promise<CodingAgentUsageTotals>;
  listForProject(input: CodingAgentSessionsListInput): Promise<CodingAgentSessionListRow[]>;
  linkTraceSessionsToPullRequests(
    input: CodingAgentTracePullRequestInput,
  ): Promise<CodingAgentTracePullRequestLink[]>;
  getPullRequestUsage(
    input: CodingAgentPullRequestUsageInput,
  ): Promise<CodingAgentPullRequestUsage>;
  getPullRequestDetail(
    input: CodingAgentPullRequestUsageInput,
  ): Promise<CodingAgentPullRequestDetail>;
  getForPersonalProject(
    input: CodingAgentPersonalPullRequestUsageInput,
  ): Promise<CodingAgentPersonalPullRequestUsage>;
}

/** The one public Coding Agent contract, composed from private role-specific collaborators. */
export class CodingAgentFeatureService implements CodingAgentSessionService {
  static create(options: {
    sessions: CodingAgentSessionRepository;
    traceSessions: CodingAgentTraceSessionRepository;
    metricSeries: SessionMetricSeriesRepository;
    sessionEvents: CodingAgentSessionEventRepository;
    github: GithubApi;
    projects: ProjectApi;
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
    const shares = CodingAgentPullRequestShareService.create({ assignments });
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
      shares,
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
  ) {}

  getSessionEvents(input: CodingAgentSessionEventsInput): Promise<{
    events: CodingAgentSessionEvent[];
    nextCursor: CodingAgentSessionCursor | null;
  }> {
    return this.collaborators.sessionReads.getSessionEvents(input);
  }

  findBySessionId(input: CodingAgentSessionLookupInput): Promise<CodingAgentSession | null> {
    return this.collaborators.sessionReads.findBySessionId(input);
  }

  findSessionForTrace(
    input: CodingAgentTraceSessionLookupInput,
  ): Promise<CodingAgentSession | null> {
    return this.collaborators.sessionReads.findSessionForTrace(input);
  }

  listRecent(input: CodingAgentRecentSessionsInput): Promise<CodingAgentSession[]> {
    return this.collaborators.sessionReads.listRecent(input);
  }

  backfillPullRequestMappings(input: CodingAgentPullRequestMappingBackfillInput): Promise<void> {
    return this.collaborators.mappingBackfill.backfill(input);
  }

  getUsageTotals(input: CodingAgentUsageTotalsInput): Promise<CodingAgentUsageTotals> {
    return this.collaborators.sessionReads.getUsageTotals(input);
  }

  listForProject(input: CodingAgentSessionsListInput): Promise<CodingAgentSessionListRow[]> {
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

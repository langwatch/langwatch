import type {
  CodingAgentRecentSessionsInput,
  CodingAgentSession,
  CodingAgentSessionCursor,
  CodingAgentSessionEvent,
  CodingAgentSessionEventsInput,
  CodingAgentSessionLookupInput,
  CodingAgentTraceSessionLookupInput,
  CodingAgentSessionsListInput,
  CodingAgentSessionListRow,
  CodingAgentPullRequestUsageInput,
  CodingAgentPullRequestUsage,
  CodingAgentPersonalPullRequestUsageInput,
  CodingAgentPersonalPullRequestUsage,
  CodingAgentPullRequestDetail,
  CodingAgentUsageTotals,
  CodingAgentUsageTotalsInput,
} from "./coding-agent";

/** The one cross-feature service for the coding-agent session aggregate. */
export abstract class CodingAgentService {
  abstract getSessionEvents(input: CodingAgentSessionEventsInput): Promise<{
    events: CodingAgentSessionEvent[];
    nextCursor: CodingAgentSessionCursor | null;
  }>;

  abstract tryGetBySessionId(
    input: CodingAgentSessionLookupInput,
  ): Promise<CodingAgentSession | null>;

  abstract tryGetSessionForTrace(
    input: CodingAgentTraceSessionLookupInput,
  ): Promise<CodingAgentSession | null>;

  abstract listRecent(
    input: CodingAgentRecentSessionsInput,
  ): Promise<CodingAgentSession[]>;

  abstract getUsageTotals(
    input: CodingAgentUsageTotalsInput,
  ): Promise<CodingAgentUsageTotals>;

  abstract listForProject(
    input: CodingAgentSessionsListInput,
  ): Promise<CodingAgentSessionListRow[]>;

  abstract getPullRequestUsage(
    input: CodingAgentPullRequestUsageInput,
  ): Promise<CodingAgentPullRequestUsage>;

  abstract getPullRequestDetail(
    input: CodingAgentPullRequestUsageInput,
  ): Promise<CodingAgentPullRequestDetail>;

  abstract getForPersonalProject(
    input: CodingAgentPersonalPullRequestUsageInput,
  ): Promise<CodingAgentPersonalPullRequestUsage>;
}

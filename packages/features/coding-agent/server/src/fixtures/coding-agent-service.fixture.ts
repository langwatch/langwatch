import {
  CodingAgentService,
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

/** Test service for consumers of the contract's stateless derivations. */
export class TestCodingAgentService extends CodingAgentService {
  static create(): TestCodingAgentService {
    return new TestCodingAgentService();
  }

  private constructor() {
    super();
  }

  readonly sessionsById = new Map<string, CodingAgentSession | null>();
  readonly sessionLookupInputs: CodingAgentSessionLookupInput[] = [];
  tracePullRequestLinks: CodingAgentTracePullRequestLink[] = [];
  readonly tracePullRequestInputs: CodingAgentTracePullRequestInput[] = [];

  getSessionEvents(_input: CodingAgentSessionEventsInput): Promise<{
    events: CodingAgentSessionEvent[];
    nextCursor: CodingAgentSessionCursor | null;
  }> {
    return this.unsupported();
  }

  tryGetBySessionId(
    input: CodingAgentSessionLookupInput,
  ): Promise<CodingAgentSession | null> {
    this.sessionLookupInputs.push(input);
    return Promise.resolve(this.sessionsById.get(input.sessionId) ?? null);
  }

  tryGetSessionForTrace(
    _input: CodingAgentTraceSessionLookupInput,
  ): Promise<CodingAgentSession | null> {
    return this.unsupported();
  }

  listRecent(_input: CodingAgentRecentSessionsInput): Promise<CodingAgentSession[]> {
    return this.unsupported();
  }

  backfillPullRequestMappings(
    _input: CodingAgentPullRequestMappingBackfillInput,
  ): Promise<void> {
    return this.unsupported();
  }

  getUsageTotals(_input: CodingAgentUsageTotalsInput): Promise<CodingAgentUsageTotals> {
    return this.unsupported();
  }

  listForProject(
    _input: CodingAgentSessionsListInput,
  ): Promise<CodingAgentSessionListRow[]> {
    return this.unsupported();
  }

  linkTraceSessionsToPullRequests(
    input: CodingAgentTracePullRequestInput,
  ): Promise<CodingAgentTracePullRequestLink[]> {
    this.tracePullRequestInputs.push(input);
    return Promise.resolve(this.tracePullRequestLinks);
  }

  getPullRequestUsage(
    _input: CodingAgentPullRequestUsageInput,
  ): Promise<CodingAgentPullRequestUsage> {
    return this.unsupported();
  }

  getPullRequestDetail(
    _input: CodingAgentPullRequestUsageInput,
  ): Promise<CodingAgentPullRequestDetail> {
    return this.unsupported();
  }

  getForPersonalProject(
    _input: CodingAgentPersonalPullRequestUsageInput,
  ): Promise<CodingAgentPersonalPullRequestUsage> {
    return this.unsupported();
  }

  private unsupported(): Promise<never> {
    return Promise.reject(new Error("TestCodingAgentService method is not configured"));
  }
}

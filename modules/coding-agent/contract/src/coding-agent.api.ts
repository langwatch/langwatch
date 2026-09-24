import { moduleApi } from "@langwatch/kernel/module-api";
import type { SpanDetail } from "@langwatch/trace-contract";

import type { LogContentKey } from "./coding-agent-log-content.ts";
import type { ContributeSpanFactsCommandData } from "./coding-agent-processing.commands.ts";
import type {
  CodingAgentTracePullRequestInput,
  CodingAgentTracePullRequestLink,
} from "./coding-agent-trace-pull-request.ts";
import type { CodingAgentTranscript, TranscriptLogRecord } from "./coding-agent-transcript.ts";
import type {
  CodingAgentSessionLookupInput,
  CodingAgentGithubConnection,
  CodingAgentPersonalPullRequestUsage,
  CodingAgentPullRequestDetail,
  CodingAgentPullRequestMappingBackfillInput,
  CodingAgentPullRequestUsage,
  CodingAgentRecentSessionsInput,
  CodingAgentSession,
  CodingAgentSessionCursor,
  CodingAgentSessionEvent,
  CodingAgentSessionEventsInput,
  CodingAgentSessionListRow,
  CodingAgentSessionsListInput,
  CodingAgentUsageTotals,
  CodingAgentUsageTotalsInput,
} from "./coding-agent.ts";

export type CodingAgentCallerScope =
  | { readonly kind: "user"; readonly userId: string }
  | { readonly kind: "apiKey"; readonly apiKeyId: string; readonly userId: string | null };

/** Who a viewer-scoped read is answered for. */
export type CodingAgentViewer = { readonly id: string };

/** The input `shouldFilterSpan` decides from: no store read, no session lookup. */
export type CodingAgentSpanFilterInput = {
  scopeName: string | null | undefined;
  spanName: string;
  attributeKeys: readonly string[];
};

/**
 * One read of a pull request's usage rollup, as it is written down. Never the
 * contributors themselves: how many projects fed it says how wide the read
 * reached without copying the names into a second store that outlives it.
 */
export type CodingAgentPullRequestUsageRead = Readonly<{
  /** Who read it, as the door that answered resolved them. */
  readerUserId: string;
  organizationId: string;
  repositoryHost: string;
  repositoryFullName: string;
  prNumber: number;
  contributingProjectCount: number;
}>;

/**
 * What the install-wide usage report counts here (ADR-156, section 10): the
 * sessions started, since `since` where one is given, and when the first
 * session started. A session folded twice counts once. Epoch milliseconds.
 */
export interface CodingAgentUsageCount {
  readonly sessions: number;
  readonly firstSessionAt?: number;
}

export interface CodingAgentApi {
  logContentKeys(eventName: string): readonly LogContentKey[];
  contentAttrKeys(eventName: string): readonly string[];
  shouldFilterSpan(input: CodingAgentSpanFilterInput): boolean;
  buildTranscript(input: {
    spans: SpanDetail[];
    logs: TranscriptLogRecord[];
  }): CodingAgentTranscript;
  findBySessionId(input: CodingAgentSessionLookupInput): Promise<CodingAgentSession | null>;
  findSessionForTrace(input: {
    projectId: string;
    traceId: string;
  }): Promise<CodingAgentSession | null>;
  linkTraceSessionsToPullRequests(
    input: CodingAgentTracePullRequestInput,
  ): Promise<CodingAgentTracePullRequestLink[]>;
  getSessionEvents(input: CodingAgentSessionEventsInput): Promise<{
    events: CodingAgentSessionEvent[];
    nextCursor: CodingAgentSessionCursor | null;
  }>;
  getUsageTotals(input: CodingAgentUsageTotalsInput): Promise<CodingAgentUsageTotals>;
  listRecent(input: CodingAgentRecentSessionsInput): Promise<CodingAgentSession[]>;
  backfillPullRequestMappings(input: CodingAgentPullRequestMappingBackfillInput): Promise<void>;
  /**
   * The Sessions screen's rows, cut to what this viewer may see: the generated
   * title follows the project's content visibility, the cost follows
   * `cost:view`.
   */
  listForProject(
    input: CodingAgentSessionsListInput,
    by: CodingAgentViewer,
  ): Promise<CodingAgentSessionListRow[]>;
  /** Queues one span's bounded session facts onto coding_agent_processing (ADR-056/069). */
  contributeSpanFacts(data: ContributeSpanFactsCommandData): Promise<void>;
  /** Records who read an answer that names people. */
  recordPullRequestUsageRead(read: CodingAgentPullRequestUsageRead): Promise<void>;
  githubWebBase(): string;
  findOrganizationForProject(projectId: string): Promise<string | undefined>;
  getPullRequestUsage(
    pullRequest: {
      projectId: string;
      repositoryHost: string;
      repositoryFullName: string;
      prNumber: number;
    },
    by: CodingAgentCallerScope,
  ): Promise<{ usage: CodingAgentPullRequestUsage; organizationId: string }>;
  getOrganizationPullRequestUsage(
    pullRequest: {
      organizationId: string;
      repositoryHost: string;
      repositoryFullName: string;
      prNumber: number;
    },
    by: CodingAgentCallerScope,
  ): Promise<CodingAgentPullRequestUsage>;
  getPullRequestDetail(
    pullRequest: {
      projectId: string;
      repositoryHost: string;
      repositoryFullName: string;
      prNumber: number;
    },
    by: { readonly id: string },
  ): Promise<CodingAgentPullRequestDetail>;
  getPersonalProjectPullRequestUsage(
    input: { projectId: string },
    by: { readonly id: string },
  ): Promise<CodingAgentPersonalPullRequestUsage & { connection: CodingAgentGithubConnection }>;
  githubConnection(organizationId: string | undefined): Promise<CodingAgentGithubConnection>;
  /** The usage report's figures (ADR-156, section 10). */
  countUsage(input: {
    projectIds: readonly string[];
    since?: number;
  }): Promise<CodingAgentUsageCount>;
}

export const CodingAgentApi = moduleApi<CodingAgentApi>()("coding-agent");

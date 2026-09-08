import type { CodingAgentSessionLookupInput } from "./coding-agent.ts";
import { featureApi } from "@langwatch/runtime-composition";
import type {
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
import type { SpanDetail } from "@langwatch/trace-contract";
import type { CodingAgentTranscript, TranscriptLogRecord } from "./coding-agent-transcript.ts";
import type { LogContentKey } from "./coding-agent-log-content.ts";
import type {
  CodingAgentTracePullRequestInput,
  CodingAgentTracePullRequestLink,
} from "./coding-agent-trace-pull-request.ts";

export type CodingAgentCallerScope =
  | { readonly kind: "user"; readonly userId: string }
  | { readonly kind: "apiKey"; readonly apiKeyId: string; readonly userId: string | null };

export interface CodingAgentApi {
  logContentKeys(eventName: string): readonly LogContentKey[];
  contentAttrKeys(eventName: string): readonly string[];
  shouldFilterSpan(input: {
    scopeName: string | null | undefined;
    spanName: string;
    attributeKeys: readonly string[];
  }): boolean;
  buildTranscript(input: {
    spans: SpanDetail[];
    logs: TranscriptLogRecord[];
  }): CodingAgentTranscript;
  tryGetBySessionId(input: CodingAgentSessionLookupInput): Promise<CodingAgentSession | null>;
  tryGetSessionForTrace(input: {
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
  listForProject(input: CodingAgentSessionsListInput): Promise<CodingAgentSessionListRow[]>;
  githubWebBase(): string;
  tryResolveOrganizationForProject(projectId: string): Promise<string | undefined>;
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
}

export const CodingAgentApi = featureApi<CodingAgentApi>("coding-agent");

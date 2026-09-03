import type {
  CodingAgentRecentSessionsInput,
  CodingAgentPullRequestMappingBackfillInput,
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
import type { SpanDetail } from "@langwatch/trace-contract";
import {
  contentAttrKeys,
  logContentKeys,
  type LogContentKey,
} from "./coding-agent-log-content";
import {
  buildCodingAgentTranscript,
  type CodingAgentTranscript,
  type TranscriptLogRecord,
} from "./coding-agent-transcript";
import { shouldFilterCodingAgentSpan } from "./telemetry/coding-agent-span-filter";
import type {
  CodingAgentTracePullRequestInput,
  CodingAgentTracePullRequestLink,
} from "./coding-agent-trace-pull-request";

export type CodingAgentSpanFilterInput = {
  scopeName: string | null | undefined;
  spanName: string;
  attributeKeys: readonly string[];
};

/** The one cross-feature service for the coding-agent session aggregate. */
export abstract class CodingAgentService {
  buildTranscript(input: {
    spans: SpanDetail[];
    logs: TranscriptLogRecord[];
  }): CodingAgentTranscript {
    return buildCodingAgentTranscript(input);
  }

  logContentKeys(eventName: string): readonly LogContentKey[] {
    return logContentKeys(eventName);
  }

  contentAttrKeys(eventName: string): readonly string[] {
    return contentAttrKeys(eventName);
  }

  shouldFilterSpan(input: CodingAgentSpanFilterInput): boolean {
    return shouldFilterCodingAgentSpan(input);
  }

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

  abstract backfillPullRequestMappings(
    input: CodingAgentPullRequestMappingBackfillInput,
  ): Promise<void>;

  abstract getUsageTotals(
    input: CodingAgentUsageTotalsInput,
  ): Promise<CodingAgentUsageTotals>;

  abstract listForProject(
    input: CodingAgentSessionsListInput,
  ): Promise<CodingAgentSessionListRow[]>;

  abstract linkTraceSessionsToPullRequests(
    input: CodingAgentTracePullRequestInput,
  ): Promise<CodingAgentTracePullRequestLink[]>;

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

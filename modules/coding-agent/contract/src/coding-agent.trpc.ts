/**
 * Every `codingAgents.*` procedure, declared once. The names are the browser's
 * cache keys, so they are the wire names the Sessions screen, the personal
 * usage card and the pull-request drawer have always called.
 */
import { defineTrpcContract } from "@langwatch/api/contract";

import { codingAgentTranscriptSchema } from "./coding-agent-transcript.ts";
import {
  codingAgentTrpcProjectScopeSchema,
  codingAgentTrpcPullRequestDetailInputSchema,
  codingAgentTrpcRecentSessionsInputSchema,
  codingAgentTrpcTraceScopeSchema,
  codingAgentTrpcUsageTotalsInputSchema,
} from "./coding-agent-trpc.schemas.ts";
import {
  codingAgentPersonalPullRequestUsageWithConnectionSchema,
  codingAgentPullRequestDetailSchema,
  codingAgentSessionListRowSchema,
  codingAgentSessionSchema,
  codingAgentUsageTotalsSchema,
} from "./coding-agent.ts";

export const codingAgentTrpc = defineTrpcContract("codingAgents")
  // Cost, tokens, active time and session count for a project's window.
  // Metric-only sessions are included.
  .query("usageTotals")
  .withInput(codingAgentTrpcUsageTotalsInputSchema)
  .withOutput(codingAgentUsageTotalsSchema)

  // The stored rows verbatim, newest first, for the personal usage card.
  .query("recentSessions")
  .withInput(codingAgentTrpcRecentSessionsInputSchema)
  .withOutput(codingAgentSessionSchema.array())

  // The Sessions screen's display projection: the columns the table shows,
  // with the organization's pull-request mapping joined onto the page.
  .query("sessionsList")
  .withInput(codingAgentTrpcProjectScopeSchema)
  .withOutput(codingAgentSessionListRowSchema.array())

  // The pull requests, the branches whose pull request is not mapped yet, and
  // whether GitHub is connected at all — one read, because the page needs all
  // three to decide what to render.
  .query("pullRequestUsage")
  .withInput(codingAgentTrpcProjectScopeSchema)
  .withOutput(codingAgentPersonalPullRequestUsageWithConnectionSchema)

  // One pull request in full: its totals, who worked on it, what each model
  // consumed, and the sessions that ran.
  .query("pullRequestDetail")
  .withInput(codingAgentTrpcPullRequestDetailInputSchema)
  .withOutput(codingAgentPullRequestDetailSchema)

  // The session one trace belongs to, or null. Main served it as `traces.codingAgentSession`.
  .query("session")
  .withInput(codingAgentTrpcTraceScopeSchema.omit({ occurredAtMs: true }))
  .withOutput(codingAgentSessionSchema.nullable())

  // One trace's transcript through the viewer's redactions. Main: `traces.codingAgentTranscript`.
  .query("transcript")
  .withInput(codingAgentTrpcTraceScopeSchema)
  .withOutput(codingAgentTranscriptSchema)
  .build();

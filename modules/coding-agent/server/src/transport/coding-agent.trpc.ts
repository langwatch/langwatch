/**
 * The server half of `codingAgents.*`, the session read surface the browser
 * calls (ADR-056). Project-scoped and gated by `traces:view`, like tracesV2;
 * viewer-scoped redaction is the application's, whichever door asks.
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { CodingAgentApi, codingAgentTrpc } from "@langwatch/coding-agent-contract";
import { nowInstant } from "@langwatch/time";

/** The permission cut every procedure on this surface declares. */
const CODING_AGENT_PERMISSION = "traces:view";

/** Default look-back for the personal usage card: the trailing 30 days. */
const DEFAULT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** The window a screen asked for, closed against the clock at either open end. */
function windowOf(input: { fromMs?: number | undefined; toMs?: number | undefined }): {
  fromMs: number;
  toMs: number;
} {
  const toMs = input.toMs ?? nowInstant().epochMilliseconds;

  return { fromMs: input.fromMs ?? toMs - DEFAULT_WINDOW_MS, toMs };
}

export const codingAgentTrpcTransport = defineTrpcRouter(CodingAgentApi, codingAgentTrpc)
  .procedure("usageTotals")
  .withPermission(CODING_AGENT_PERMISSION)
  .handle(({ app, input }) =>
    app.getUsageTotals({ projectId: input.projectId, ...windowOf(input) }),
  )

  .procedure("recentSessions")
  .withPermission(CODING_AGENT_PERMISSION)
  .handle(({ app, input }) =>
    app.listRecent({
      projectId: input.projectId,
      ...windowOf(input),
      limit: input.limit ?? 50,
    }),
  )

  .procedure("sessionsList")
  .withPermission(CODING_AGENT_PERMISSION)
  .handle(({ app, input, actor }) => app.listForProject({ projectId: input.projectId }, actor))

  .procedure("pullRequestUsage")
  .withPermission(CODING_AGENT_PERMISSION)
  .handle(({ app, input, actor }) =>
    app.getPersonalProjectPullRequestUsage({ projectId: input.projectId }, actor),
  )

  .procedure("pullRequestDetail")
  .withPermission(CODING_AGENT_PERMISSION)
  .handle(({ app, input, actor }) => app.getPullRequestDetail(input, actor))
  .build();

import { createLogger } from "@langwatch/observability";

import type {
  ReactorContext,
  ReactorDefinition,
} from "../../../reactors/reactor.types";
import { throttledPerWindow } from "../../../reactors/throttleWindow";
import type { CodingAgentSessionState } from "../projections/codingAgentSession.foldProjection";
import type { CodingAgentProcessingEvent } from "../schemas/events";

const logger = createLogger(
  "langwatch:coding-agent-processing:pull-request-mapping-reactor",
);

/**
 * The window one branch's mapping job collapses into.
 *
 * Thirty seconds is a deliberate trade. The window has to be non-zero to
 * deduplicate at all (see `throttledPerWindow`: the dedup key only collapses
 * events while the job is still waiting to dispatch), and every second of it is
 * lag a person sees when they open a pull request, run a session, and wait for
 * the row to appear. Thirty seconds is long enough to collapse a session's
 * coalesced batch and the successive batches a busy session commits, and short
 * enough that a brand-new branch maps while the developer is still looking at
 * it.
 *
 * The long horizon is NOT this window's job. Protecting GitHub across hours,
 * restarts and replicas is the durable branch bookkeeping in the mapping
 * service, which already refuses to re-ask about a freshly mapped branch for
 * fifteen minutes and backs an empty one off for up to a day. This window only
 * has to stop one session's own event stream from queueing a job per event.
 */
const MAPPING_WINDOW_MS = 30 * 1000;

/** What the reactor needs from the mapping service. */
export interface PullRequestMappingReactorDeps {
  requestBranchMapping(params: {
    tenantId: string;
    repositoryHost: string;
    repositoryOwner: string;
    repositoryName: string;
    headBranch: string;
  }): Promise<void>;
}

/**
 * Pure hot-path guard. Most sessions carry no git context at all (only agents
 * with a companion emitter report it), so this rejects the majority before any
 * job is staged. A repository on another host is rejected here too: no GitHub
 * call can answer for it, and enqueueing a job that would immediately return is
 * pure queue traffic.
 */
export function shouldMapPullRequests(
  state: Pick<
    CodingAgentSessionState,
    "repositoryHost" | "repositoryOwner" | "repositoryName" | "gitBranch"
  >,
): boolean {
  const host = state.repositoryHost ?? "";
  if (host !== "" && host !== "github.com") return false;
  return Boolean(
    state.repositoryOwner &&
      state.repositoryName &&
      state.gitBranch &&
      state.repositoryOwner.length > 0 &&
      state.repositoryName.length > 0 &&
      state.gitBranch.length > 0,
  );
}

/** The dedup id: one job per (project, repository, branch). */
export function pullRequestMappingJobId({
  tenantId,
  state,
}: {
  tenantId: string;
  state: Pick<
    CodingAgentSessionState,
    "repositoryOwner" | "repositoryName" | "gitBranch"
  >;
}): string {
  return `prmap:${tenantId}:${state.repositoryOwner}/${state.repositoryName}:${state.gitBranch}`;
}

/**
 * Reactor that asks the organization's GitHub connection which pull requests a
 * folded session's branch has hosted.
 *
 * Every error is logged and swallowed. Mapping is enrichment: the session row,
 * its counters and its cost are already committed, and rethrowing would put the
 * job back on the queue to hit the same rate limit again, turning one refused
 * GitHub call into a retry storm against the same limit.
 *
 * Spec: specs/coding-agent/pull-request-linkage.feature.
 */
export function createPullRequestMappingReactor(
  deps: PullRequestMappingReactorDeps,
): ReactorDefinition<CodingAgentProcessingEvent, CodingAgentSessionState> {
  return {
    name: "pullRequestMapping",
    shouldReact: (_event, context) => shouldMapPullRequests(context.foldState),
    options: {
      runIn: ["worker"],
      ...throttledPerWindow({
        makeJobId: (payload) =>
          pullRequestMappingJobId({
            tenantId: payload.event.tenantId,
            state: payload.foldState as CodingAgentSessionState,
          }),
        windowMs: MAPPING_WINDOW_MS,
      }),
    },

    async handle(
      _event: CodingAgentProcessingEvent,
      context: ReactorContext<CodingAgentSessionState>,
    ): Promise<void> {
      const { tenantId, foldState } = context;
      if (!shouldMapPullRequests(foldState)) return;

      try {
        await deps.requestBranchMapping({
          tenantId,
          repositoryHost: foldState.repositoryHost ?? "",
          repositoryOwner: foldState.repositoryOwner!,
          repositoryName: foldState.repositoryName!,
          headBranch: foldState.gitBranch!,
        });
      } catch (error) {
        logger.warn(
          {
            error,
            tenantId,
            repositoryOwner: foldState.repositoryOwner,
            repositoryName: foldState.repositoryName,
            gitBranch: foldState.gitBranch,
          },
          "pull-request mapping failed, non-fatal, the next fold retries it",
        );
      }
    },
  };
}

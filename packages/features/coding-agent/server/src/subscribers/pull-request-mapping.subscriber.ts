import { throttledWindow, type SubscriberSpec, type TriggerContext } from "@langwatch/eventing";
import type { CodingAgentPullRequestMappingPort } from "../ports/coding-agent-pull-request-mapping.port";
import { createLogger } from "@langwatch/observability";
import type { CodingAgentSessionState } from "../projections/coding-agent-session.projection";
import type { CodingAgentProcessingEvent } from "@langwatch/coding-agent-contract";
import { z } from "zod";

const logger = createLogger("langwatch:coding-agent-processing:pull-request-mapping");

/**
 * The window one branch's mapping job collapses into.
 *
 * Thirty seconds is a deliberate trade. The window has to be non-zero to
 * deduplicate at all (see `throttledWindow`: the dedup key only collapses
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
export const PULL_REQUEST_MAPPING_WINDOW_MS = 30 * 1000;

export const pullRequestMappingStateSchema = z.object({
  repositoryHost: z.string().nullable(),
  repositoryOwner: z.string().nullable(),
  repositoryName: z.string().nullable(),
  gitBranch: z.string().nullable(),
});
type PullRequestMappingState = z.infer<typeof pullRequestMappingStateSchema>;

/**
 * Pure hot-path guard. Most sessions carry no git context at all (only agents
 * with a companion emitter report it), so this rejects the majority before any
 * job is staged. A repository on another host is rejected here too: no GitHub
 * call can answer for it, and enqueueing a job that would immediately return is
 * pure queue traffic.
 */
export function shouldMapPullRequests(
  input: {
    repositoryHost?: string | null;
    repositoryOwner?: string | null;
    repositoryName?: string | null;
    gitBranch?: string | null;
  },
  github: CodingAgentPullRequestMappingPort,
): boolean {
  if (!github.canMapRepositoryHost(input.repositoryHost ?? "")) return false;
  return Boolean(
    input.repositoryOwner &&
    input.repositoryName &&
    input.gitBranch &&
    input.repositoryOwner.length > 0 &&
    input.repositoryName.length > 0 &&
    input.gitBranch.length > 0,
  );
}

/**
 * The dedup id: one job per (project, repository, branch).
 *
 * The host is deliberately absent, and that is safe rather than an oversight:
 * `shouldMapPullRequests` only lets `""` and the instance's own GitHub host
 * through, and both normalize to that one host at the service, so two folds
 * sharing this key always name the same repository. Which is what makes
 * collapsing them into one job the same answer rather than a guess.
 *
 * The owner and the name are folded, which is the other half of that same
 * argument. A session records whatever casing its git remote carries, and
 * everything below this job keys the repository lowercased: the durable branch
 * claim in the mapping service already resolves `Acme/Widgets` and
 * `acme/widgets` to one row. Leaving them raw here would not cost a second
 * GitHub call, because the second job loses that claim, but it would stage a
 * job whose only possible outcome is to lose it, and split one branch's work
 * across two queue groups on the way. Folding makes the throttle see the one
 * repository the claim sees.
 *
 * `gitBranch` is not folded: `feat/X` and `feat/x` really are two branches, and
 * collapsing them would map one and leave the other with no pull request.
 * `tenantId` is an opaque id rather than a name, so it is keyed verbatim.
 */
export function pullRequestMappingJobId({
  tenantId,
  state,
}: {
  tenantId: string;
  state: PullRequestMappingState;
}): string {
  const repository = `${state.repositoryOwner}/${state.repositoryName}`.toLowerCase();
  return `prmap:${tenantId}:${repository}:${state.gitBranch}`;
}

/**
 * The queue group: the same repository and branch the dedup id is keyed on.
 *
 * The dedup key is queue-global, but the squash it protects is not: the staging
 * script only collapses a duplicate while `ZRANK(group:<groupId>:jobs, …)` finds
 * the existing job in the NEW payload's own group. Under the default
 * per-aggregate grouping, two sessions on one branch produce the same dedup id
 * in two different groups, the rank lookup misses, and the script reads the miss
 * as "already dispatched" — which is exactly the workload this feature is for,
 * several agent worktrees on one branch. Grouping on what the key is keyed on is
 * what makes the lookup hit.
 *
 * What else grouping decides, and why each is fine or better here:
 *   - ORDERING. A group is the serialization unit. These jobs are idempotent
 *     re-asks of one question about one branch; there is no order between two of
 *     them to preserve, and serializing them is the point.
 *   - FAIRNESS. `QueueManager` prefixes every group with the tenant, so this
 *     changes the shape of a tenant's groups, never their tenancy. It trades
 *     one group per session for one per (repository, branch) — fewer, longer
 *     lived lanes carrying rare jobs, rather than a lane per session carrying
 *     one.
 *   - THE FOLD'S OWN SERIALIZATION. Untouched. A subscriber's lane is its own
 *     (`<tenant>/fold/<fold>/reactor/<subscriber>/…`); the session fold keeps
 *     grouping on the session, so one session's contributions still apply in
 *     order.
 */
export function pullRequestMappingGroupKey({
  tenantId,
  state,
}: {
  tenantId: string;
  state: PullRequestMappingState;
}): string {
  return pullRequestMappingJobId({ tenantId, state });
}

/**
 * Subscriber handler that asks the organization's GitHub connection which pull
 * requests a folded session's branch has hosted.
 *
 * Every error is logged and swallowed. Mapping is enrichment: the session row,
 * its counters and its cost are already committed, and rethrowing would put the
 * job back on the queue to hit the same rate limit again, turning one refused
 * GitHub call into a retry storm against the same limit.
 *
 * Spec: specs/coding-agent/pull-request-linkage.feature.
 */
export function createPullRequestMappingHandler(
  github: CodingAgentPullRequestMappingPort,
): (
  event: CodingAgentProcessingEvent,
  context: TriggerContext<CodingAgentSessionState>,
) => Promise<void> {
  return async (_event, context) => {
    const { tenantId, state: foldState } = context;
    if (
      !shouldMapPullRequests(
        {
          repositoryHost: foldState.repositoryHost ?? "",
          repositoryOwner: foldState.repositoryOwner ?? "",
          repositoryName: foldState.repositoryName ?? "",
          gitBranch: foldState.gitBranch ?? "",
        },
        github,
      )
    )
      return;

    try {
      await github.requestBranchMapping({
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
  };
}

/** The production fold subscriber, shared by composition and policy tests. */
export function createPullRequestMappingSubscriber(
  github: CodingAgentPullRequestMappingPort,
): SubscriberSpec<CodingAgentProcessingEvent> & {
  fold: "codingAgentSession";
  map?: never;
} {
  return {
    fold: "codingAgentSession",
    runIn: ["worker"],
    when: (_event, context) =>
      shouldMapPullRequests(pullRequestMappingStateSchema.parse(context.state), github),
    groupKeyFn: (event, state) =>
      pullRequestMappingGroupKey({
        tenantId: event.tenantId,
        state: pullRequestMappingStateSchema.parse(state),
      }),
    ...throttledWindow<CodingAgentProcessingEvent>({
      makeId: (event, state) =>
        pullRequestMappingJobId({
          tenantId: event.tenantId,
          state: pullRequestMappingStateSchema.parse(state),
        }),
      windowMs: PULL_REQUEST_MAPPING_WINDOW_MS,
      // Backlogged events can be immediately dispatchable. Keep the live TTL
      // so their identical branch re-asks still collapse after dispatch.
      shouldSurviveDispatch: true,
    }),
    handler: createPullRequestMappingHandler(github),
  };
}

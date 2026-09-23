import type { CodingAgentProcessingEvent } from "@langwatch/coding-agent-contract";
import { throttledWindow, type SubscriberSpec, type TriggerContext } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import { z } from "zod";

import type { CodingAgentPullRequestMapping } from "../app/coding-agent.members.ts";
import type { CodingAgentSessionState } from "./coding-agent-session.projection.ts";

const logger = createLogger("langwatch:coding-agent-processing:pull-request-mapping");

/** Window for branch mapping job; deduplicates session's event stream (30 seconds). */
export const PULL_REQUEST_MAPPING_WINDOW_MS = 30 * 1000;

export const pullRequestMappingStateSchema = z.object({
  repositoryHost: z.string().nullable(),
  repositoryOwner: z.string().nullable(),
  repositoryName: z.string().nullable(),
  gitBranch: z.string().nullable(),
});
type PullRequestMappingState = z.infer<typeof pullRequestMappingStateSchema>;

/**
 * Pure hot-path guard: most sessions carry no git context (only agents with a
 * companion emitter report it), so this rejects the majority before any job
 * is staged. A repository on another host is rejected too — no GitHub call can answer for it.
 */
export function shouldMapPullRequests(
  input: {
    repositoryHost?: string | null;
    repositoryOwner?: string | null;
    repositoryName?: string | null;
    gitBranch?: string | null;
  },
  github: CodingAgentPullRequestMapping,
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

/** Dedup id; host absent, owner/name lowercased, branch and tenant verbatim. */
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

/** Queue group (same as dedup key); enables ZRANK lookup to hit on new payloads. */
export function pullRequestMappingGroupKey({
  tenantId,
  state,
}: {
  tenantId: string;
  state: PullRequestMappingState;
}): string {
  return pullRequestMappingJobId({ tenantId, state });
}

/** Handler asks GitHub which PRs hosted this session's branch; errors logged/swallowed. */
export function createPullRequestMappingHandler(
  github: CodingAgentPullRequestMapping,
): (
  event: CodingAgentProcessingEvent,
  context: TriggerContext<CodingAgentSessionState>,
) => Promise<void> {
  return async (_event, context) => {
    const { tenantId, state: foldState } = context;
    const mapsPullRequests = shouldMapPullRequests(
      {
        repositoryHost: foldState.repositoryHost ?? "",
        repositoryOwner: foldState.repositoryOwner ?? "",
        repositoryName: foldState.repositoryName ?? "",
        gitBranch: foldState.gitBranch ?? "",
      },
      github,
    );
    if (!mapsPullRequests) return;

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
  github: CodingAgentPullRequestMapping,
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

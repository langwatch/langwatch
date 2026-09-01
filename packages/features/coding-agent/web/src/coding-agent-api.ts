/**
 * The procedures the coding-agent activity tables call, and the hooks that call
 * them.
 *
 * HAND-WRITTEN FOR NOW, MEANT TO BE GENERATED, the same statement
 * `gateway-api.ts` and `governance-api.ts` make about their own maps: the
 * procedures live in `@langwatch/coding-agent-server`, `@langwatch/github-server`
 * and `@langwatch/trace-server`, none of which a web package may import even for
 * a type, and the router type does not exist until a process instantiates it.
 * Emitting this file from the mounted router is the fix; writing it by hand is
 * the interim, and it is honest only because the payload types below are the
 * contract's wherever the contract has them — which here is nearly everywhere,
 * because this vertical already speaks in contract schemas.
 *
 * THE SEGMENT NAMES ARE LOAD-BEARING. `codingAgents`, `github` and `tracesV2`
 * are mount points on the root router, and tRPC hashes that path into the React
 * Query cache key; spell one differently and these hooks quietly stop sharing a
 * cache with the `api.codingAgents.*` call sites that have not moved.
 */

import { createFeatureApi } from "@langwatch/platform-api-client";
import type {
  CodingAgentPersonalPullRequestUsage,
  CodingAgentPullRequestDetail,
  CodingAgentSessionListRow,
} from "@langwatch/coding-agent-contract";
import type { PullRequestStatus } from "./pull-request-status";

/**
 * Whether the organization has GitHub connected, and where to install it.
 *
 * `installUrl` is null unless this deployment actually has a GitHub App to
 * install, so the empty state never offers a link that leads nowhere.
 */
export type CodingAgentGithubConnectionView = {
  connected: boolean;
  installUrl: string | null;
};

/** One pull request the page is asking the current state of. */
export type PullRequestRef = {
  repositoryHost: string;
  repositoryFullName: string;
  prNumber: number;
};

/**
 * The current state of one pull request.
 *
 * `mappedAt` is a DATE: the procedure answers with the stored row and the
 * transport runs superjson, so the instant arrives as an instant.
 */
export type PullRequestLiveStatusView = PullRequestRef & {
  status: PullRequestStatus;
  source: "live" | "snapshot";
  mappedAt: Date | null;
};

/**
 * One turn of a conversation, narrowed to what opening a replay needs.
 *
 * The procedure answers with far more per turn; nothing here renders the rest,
 * so nothing here declares it.
 */
export type ConversationTurnView = { traceId: string; timestamp: number };

export type CodingAgentApiMap = {
  codingAgents: {
    /**
     * The project's sessions of the last ninety days, as the table lists them.
     * Every instant on the row is epoch MILLISECONDS: the read projects for
     * display rather than handing back the stored row.
     */
    sessionsList: {
      query: { input: { projectId: string }; output: CodingAgentSessionListRow[] };
    };
    /**
     * The pull requests, the branches with no pull request yet, and whether
     * GitHub is connected — one read, because the page needs all three to
     * decide what to render.
     */
    pullRequestUsage: {
      query: {
        input: { projectId: string };
        output: CodingAgentPersonalPullRequestUsage & {
          connection: CodingAgentGithubConnectionView;
        };
      };
    };
    /** One pull request in full: totals, contributors, models and sessions. */
    pullRequestDetail: {
      query: {
        input: {
          projectId: string;
          repositoryHost: string;
          repositoryFullName: string;
          prNumber: number;
        };
        output: CodingAgentPullRequestDetail;
      };
    };
  };

  github: {
    pullRequestLiveStatus: {
      query: {
        input: { projectId: string; refs: readonly PullRequestRef[] };
        output: { statuses: readonly PullRequestLiveStatusView[] };
      };
    };
  };

  tracesV2: {
    /**
     * The turns of one session, oldest first. A session that stored none of
     * them answers with an empty list rather than a failure, which is what the
     * replay reports back to the reader.
     */
    conversationContext: {
      query: {
        input: { projectId: string; conversationId: string };
        output: { turns: ConversationTurnView[] } | null;
      };
    };
  };
};

/**
 * The coding-agent tables' typed tRPC hooks. Same machinery, same transport and
 * same React Query cache as the application's `api` proxy — see
 * `createFeatureApi` for why separate instances still share cache entries.
 *
 * Its Provider is mounted by the process shell. `apps/ui` may not import this
 * package (it is not a governed web package), so the screen family that renders
 * these tables — `@langwatch/user-web`'s `screens/personal-workspace` — names it
 * on the shell's behalf.
 */
export const codingAgentApi = createFeatureApi<CodingAgentApiMap>();

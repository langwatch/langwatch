/**
 * The procedures the coding-agent activity tables call, and the hooks that
 * call them. Hand-written until the mounted router can generate it
 * (ADR-130). `codingAgents`, `github` and `tracesV2` are load-bearing tRPC
 * cache-key segments — renaming one stops sharing a cache with
 * `api.codingAgents.*` call sites that have not moved.
 */

import { createFeatureApi } from "@langwatch/platform-api-client/feature-api";
import type {
  CodingAgentPersonalPullRequestUsage,
  CodingAgentPullRequestDetail,
  CodingAgentSessionListRow,
} from "@langwatch/coding-agent-contract";
import type { PullRequestStatus } from "./pull-request-status.ts";

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
 * `mappedAt` is an ISO 8601 STRING: the procedure answers with the stored
 * row and nothing transforms the wire, so the instant arrives as text.
 */
export type PullRequestLiveStatusView = PullRequestRef & {
  status: PullRequestStatus;
  source: "live" | "snapshot";
  mappedAt: string | null;
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
 * The coding-agent tables' typed tRPC hooks. Its Provider is mounted by the
 * process shell; since `apps/ui` may not import this ungoverned package,
 * `@langwatch/user-web`'s `screens/personal-workspace` names it instead.
 */
export const codingAgentApi = createFeatureApi<CodingAgentApiMap>();

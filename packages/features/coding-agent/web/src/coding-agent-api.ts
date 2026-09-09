/**
 * Procedures this package calls: derived namespaces from contract, borrowed ones
 * from features not yet split. Segment names are load - bearing for React Query cache.
 */

import type { codingAgentTrpc } from "@langwatch/coding-agent-contract";
import { createFeatureApi, type ContractApiMap } from "@langwatch/api/web";
import type { PullRequestStatus } from "./pull-request-status.ts";

/** One pull request the page is asking the current state of. */
export type PullRequestRef = {
  repositoryHost: string;
  repositoryFullName: string;
  prNumber: number;
};

/**
 * The current state of one pull request. `mappedAt` is an ISO 8601 STRING:
 * the procedure answers with the stored row and nothing transforms the wire,
 * so the instant arrives as text.
 */
export type PullRequestLiveStatusView = PullRequestRef & {
  status: PullRequestStatus;
  source: "live" | "snapshot";
  mappedAt: string | null;
};

/**
 * One turn of a conversation, narrowed to what opening a replay needs.
 * The procedure answers with far more per turn; nothing here renders the rest.
 */
export type ConversationTurnView = { traceId: string; timestamp: number };

type BorrowedProcedures = {
  github: {
    pullRequestLiveStatus: {
      query: {
        input: { projectId: string; refs: readonly PullRequestRef[] };
        output: { statuses: readonly PullRequestLiveStatusView[] };
      };
    };
  };

  tracesV2: {
    conversationContext: {
      query: {
        input: { projectId: string; conversationId: string };
        output: { turns: ConversationTurnView[] } | null;
      };
    };
  };
};

export type CodingAgentApiMap = ContractApiMap<typeof codingAgentTrpc> & BorrowedProcedures;

/**
 * The coding - agent tables' typed tRPC hooks. Its Provider is mounted by the
 * process shell; since `apps/ui` may not import this ungoverned package,
 * `@langwatch/user - web`'s `screens/personal - workspace` names it instead.
 */
export const codingAgentApi = createFeatureApi<CodingAgentApiMap>();

/** The activity tables coding-agent lends by token to the workspace screens (§10, §10.1). */

import type {
  CodingAgentPullRequestsTableProps,
  CodingAgentSessionsTableProps,
} from "@langwatch/coding-agent-contract";
import { uiTokens } from "@langwatch/module";

const codingAgent = uiTokens("coding-agent");

export const CodingAgentPullRequestsTableToken =
  codingAgent.component<CodingAgentPullRequestsTableProps>("codingAgentPullRequestsTable");
export const CodingAgentSessionsTableToken = codingAgent.component<CodingAgentSessionsTableProps>(
  "codingAgentSessionsTable",
);

/** Activity tables coding-agent lends user's workspace screens (ARCHITECTURE.md §3.4 rule 7). */

import type {
  CodingAgentPullRequestsTableProps,
  CodingAgentSessionsTableProps,
} from "@langwatch/coding-agent-contract";

import { CodingAgentActivityHostProvider } from "./coding-agent-activity-host.ts";
import { PullRequestsTable } from "./pull-requests-table.tsx";
import { SessionsTable } from "./sessions-table.tsx";

export function LentPullRequestsTable({ projectId, host }: CodingAgentPullRequestsTableProps) {
  return (
    <CodingAgentActivityHostProvider value={host}>
      <PullRequestsTable projectId={projectId} />
    </CodingAgentActivityHostProvider>
  );
}

export function LentSessionsTable({ projectId, projectSlug, host }: CodingAgentSessionsTableProps) {
  return (
    <CodingAgentActivityHostProvider value={host}>
      <SessionsTable projectId={projectId} projectSlug={projectSlug} />
    </CodingAgentActivityHostProvider>
  );
}

/** Activity tables coding-agent lends user's workspace screens (ARCHITECTURE.md §3.4 rule 7). */

import type {
  UiCodingAgentPullRequestsTableProps,
  UiCodingAgentSessionsTableProps,
} from "@langwatch/browser-host/declarations";

import { CodingAgentActivityHostProvider } from "./coding-agent-activity-host.ts";
import { PullRequestsTable } from "./pull-requests-table.tsx";
import { SessionsTable } from "./sessions-table.tsx";

export function LentPullRequestsTable({ projectId, host }: UiCodingAgentPullRequestsTableProps) {
  return (
    <CodingAgentActivityHostProvider value={host}>
      <PullRequestsTable projectId={projectId} />
    </CodingAgentActivityHostProvider>
  );
}

export function LentSessionsTable({
  projectId,
  projectSlug,
  host,
}: UiCodingAgentSessionsTableProps) {
  return (
    <CodingAgentActivityHostProvider value={host}>
      <SessionsTable projectId={projectId} projectSlug={projectSlug} />
    </CodingAgentActivityHostProvider>
  );
}

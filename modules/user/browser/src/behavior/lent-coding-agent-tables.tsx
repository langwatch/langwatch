/** What coding-agent lends this module by token (ARCHITECTURE.md §10, §10.1). */

import { Lent } from "@langwatch/browser-host/lent";
import {
  CodingAgentPullRequestsTableToken,
  CodingAgentSessionsTableToken,
} from "@langwatch/coding-agent-contract";

import { usePersonalWorkspaceHost } from "../model/personal-workspace-host.ts";

/** Coding-agent's pull requests table, over this workspace's host. */
export function CodingAgentPullRequestsTable({ projectId }: { projectId: string }) {
  const host = usePersonalWorkspaceHost();
  return <Lent of={CodingAgentPullRequestsTableToken} props={{ projectId, host }} />;
}

/** Coding-agent's sessions table, over this workspace's host. */
export function CodingAgentSessionsTable({
  projectId,
  projectSlug,
}: {
  projectId: string;
  projectSlug: string | null;
}) {
  const host = usePersonalWorkspaceHost();
  return <Lent of={CodingAgentSessionsTableToken} props={{ projectId, projectSlug, host }} />;
}

/** The activity tables coding-agent lends by token to the workspace screens (§10, §10.1). */

import { uiTokens } from "@langwatch/module";

/** The surface the lent tables read: where they are, who asks, and toasts. */
export type CodingAgentActivityHost = {
  hasPermission(permission: string): boolean;
  route(): {
    params: Readonly<Record<string, string | undefined>>;
    query: Readonly<Record<string, string | undefined>>;
  };
  setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void;
  navigate(to: string): void;
  succeeded(notice: { title: string; description?: string; id?: string }): void;
  failed(failure: { error: unknown; fallbackTitle: string; id?: string }): void;
};

/** What a screen hands coding-agent's pull requests table. */
export type CodingAgentPullRequestsTableProps = {
  projectId: string;
  host: CodingAgentActivityHost;
};

/** What a screen hands coding-agent's sessions table. */
export type CodingAgentSessionsTableProps = {
  projectId: string;
  projectSlug: string | null;
  host: CodingAgentActivityHost;
};

export const CodingAgentPullRequestsTableToken = uiTokens(
  "coding-agent",
).component<CodingAgentPullRequestsTableProps>("codingAgentPullRequestsTable");
export const CodingAgentSessionsTableToken = uiTokens(
  "coding-agent",
).component<CodingAgentSessionsTableProps>("codingAgentSessionsTable");

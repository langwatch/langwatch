import type { RouterOutputs } from "~/utils/api";

import { sessionLastUpdateAtMs, sessionTotalTokens } from "../useSessionsSort";

/** One session as the read hands it over. */
export type SessionPayload =
  RouterOutputs["codingAgents"]["sessionsList"][number];

/** One pull request a session drove. */
export type SessionPullRequest = SessionPayload["pullRequests"][number];

/**
 * One line of the table: the read's own row, plus the two figures the table
 * orders and narrows by, worked out once rather than on every comparison.
 */
export interface SessionListRow extends SessionPayload {
  /** `owner/name`, or empty when the session reported no remote. */
  repositoryFullName: string;
  /** When the session last moved: its last event, or its start. */
  lastUpdateAtMs: number;
  /** Every token it consumed, live and cached alike. */
  totalTokens: number;
}

/** The read's row, with the figures the table orders and narrows by. */
export function toListRow(row: SessionPayload): SessionListRow {
  return {
    ...row,
    repositoryFullName:
      row.repositoryOwner && row.repositoryName
        ? `${row.repositoryOwner}/${row.repositoryName}`
        : "",
    lastUpdateAtMs: sessionLastUpdateAtMs(row),
    totalTokens: sessionTotalTokens(row),
  };
}

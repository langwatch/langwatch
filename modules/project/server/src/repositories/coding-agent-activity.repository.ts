/**
 * The project reads and writes the coding-agent session pipeline performs:
 * resolving the organization a tenant belongs to, and the two throttled
 * activity stamps a fold writes.
 */
export interface CodingAgentActivityRepository {
  /** The organization an active project belongs to; an archived project is not found. */
  getOrganizationId(projectId: string): Promise<string>;
  /** Stamps a project as having just seen coding-agent session activity. */
  touchCodingAgentSessionSeen(input: { projectId: string; at: Date }): Promise<void>;
  /** Stamps a project as having just had a coding-agent pull request mapped. */
  touchCodingAgentPullRequestSeen(input: { projectId: string; at: Date }): Promise<void>;
}

/**
 * How stale a project's recorded coding-agent activity has to be before the
 * next fold writes it again — shorter turns a busy fleet's folds into
 * Postgres traffic, longer leaves settings surfaces reading a stale date.
 */
export const CODING_AGENT_ACTIVITY_TOUCH_MS = 60 * 60 * 1000;

export function codingAgentActivityStaleBefore(at: Date): Date {
  return new Date(at.getTime() - CODING_AGENT_ACTIVITY_TOUCH_MS);
}

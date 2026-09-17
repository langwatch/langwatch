import type { Instant } from "@langwatch/time";

/**
 * The project reads and writes the coding-agent session pipeline performs:
 * resolving the organization a tenant belongs to, and the two throttled
 * activity stamps a fold writes.
 */
export interface CodingAgentActivityRepository {
  /** The organization an active project belongs to; an archived project is not found. */
  findOrganizationId(projectId: string): Promise<string>;
  /** Stamps a project as having just seen coding-agent session activity. */
  touchCodingAgentSessionSeen(input: { projectId: string; at: Instant }): Promise<void>;
  /** Stamps a project as having just had a coding-agent pull request mapped. */
  touchCodingAgentPullRequestSeen(input: { projectId: string; at: Instant }): Promise<void>;
}

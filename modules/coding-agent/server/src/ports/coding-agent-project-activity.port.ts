import type { Instant } from "@langwatch/time";

/**
 * The one project write a folded session performs.
 *
 * Storing a session stamps its project as having seen coding-agent activity,
 * so the settings surfaces can tell a project that has ever run an agent from
 * one that has not. It is a single throttled `UPDATE` against one column — and
 * to reach it the pipeline used to take the whole project application, which
 * is composed from a Prisma repository, an authorization service, a topic
 * clustering port, a credentials adapter and the transports' collaborators.
 * None of those is asked anything here.
 *
 * `ProjectApi` satisfies it: the module's application carries this method with
 * this signature, so a composition root hands its app straight over.
 */
export abstract class CodingAgentProjectActivityPort {
  /**
   * Records that this project has just seen coding-agent session activity.
   *
   * The staleness window the write is throttled by belongs to the
   * implementation, not the caller: both graphs must skip the same writes, and
   * a caller that named its own would make that a coincidence.
   */
  abstract touchCodingAgentSessionSeen(input: { projectId: string; at: Instant }): Promise<void>;
}

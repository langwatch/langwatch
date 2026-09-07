import type { toDate } from "@langwatch/time";

/** The moment this seam carries. The project feature stamps the column through
 *  Prisma, which takes a `Date`, so the caller converts before it crosses. */
type ProjectActivityMoment = ReturnType<typeof toDate>;

/**
 * The one project write a folded session performs.
 *
 * Storing a session stamps its project as having seen coding-agent activity,
 * so the settings surfaces can tell a project that has ever run an agent from
 * one that has not. It is a single throttled `UPDATE` against one column — and
 * to reach it the pipeline used to take the whole `ProjectService`, which is
 * composed from a Prisma repository, an authorization service, a topic
 * clustering port, a credentials adapter and the transports' collaborators.
 * None of those is asked anything here.
 *
 * `ProjectService` satisfies it: the published service carries this method
 * with this signature, which is what keeps the frozen registration in
 * `platform/app` compiling.
 */
export abstract class CodingAgentProjectActivityPort {
  /**
   * Records that this project has just seen coding-agent session activity.
   *
   * The staleness window the write is throttled by belongs to the
   * implementation, not the caller: both graphs must skip the same writes, and
   * a caller that named its own would make that a coincidence.
   */
  abstract touchCodingAgentSessionSeen(input: {
    projectId: string;
    at: ProjectActivityMoment;
  }): Promise<void>;
}

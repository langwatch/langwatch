import {
  PrismaCodingAgentActivityRepository,
  type PrismaCodingAgentActivityDatabase,
} from "../repositories/prisma/prisma.coding-agent-activity.repository";

/** The one model the coding-agent activity seam needs from the client. */
export type CodingAgentActivityDatabase = PrismaCodingAgentActivityDatabase;

/**
 * The project operations the coding-agent session pipeline performs, composed
 * from one Prisma client and nothing else.
 *
 * A background worker that folds coding-agent sessions has to resolve the
 * organization a tenant belongs to and stamp two activity columns. Reaching
 * those through `ProjectService` meant composing the App — a repository, an
 * authorization service, a topic clustering port, a credentials adapter and
 * both transports' collaborators — so this is the seam that makes them
 * reachable on their own.
 *
 * The object it builds satisfies both narrow ports the consumers declare:
 * Coding Agent's `CodingAgentProjectActivityPort` (the session stamp) and
 * GitHub's `GithubProjectActivityPort` (the organization read and the pull
 * request stamp). `ProjectService` satisfies both as well, which is what keeps
 * the App's own compositions compiling unchanged.
 */
export class PostgresCodingAgentActivityAdapter {
  static create(options: {
    database: CodingAgentActivityDatabase;
  }): PostgresCodingAgentActivityAdapter {
    return new PostgresCodingAgentActivityAdapter(options.database);
  }

  private constructor(private readonly database: CodingAgentActivityDatabase) {}

  build(): PrismaCodingAgentActivityRepository {
    return PrismaCodingAgentActivityRepository.create(this.database);
  }
}

import {
  PrismaJoinRequestAudienceRepository,
  type PrismaJoinRequestAudienceDatabase,
} from "./prisma.join-request-audience.repository.ts";
import type { JoinRequestMailPort } from "../../app/identity.infrastructure.ts";
import { JoinRequestNotificationService } from "../../services/join-request-notification.service.ts";

/** Every model a join-request notification reads, and no other. */
export type JoinRequestNotificationDatabase = PrismaJoinRequestAudienceDatabase;

export type PostgresJoinRequestNotificationOptions = {
  /** The composition root's own typed client, handed down with no cast. */
  database: JoinRequestNotificationDatabase;
  /** How the two wake-driven mails are rendered and sent. */
  mail: JoinRequestMailPort;
};

/**
 * The Postgres composition seam for the join request's wake notifications.
 *
 * Everything behind the audience is plain Postgres over models this schema
 * already carries — the request row, the organization's name, its admins, and
 * the requester's own name and address. The only dependency that is not a
 * table is the mail port, which is exactly the split this seam exists to make:
 * a process holding a typed client and a mail gateway composes these
 * notifications for itself rather than receiving them from a tier that had
 * both.
 */
export class PostgresJoinRequestNotificationAdapter {
  static create(
    options: PostgresJoinRequestNotificationOptions,
  ): PostgresJoinRequestNotificationAdapter {
    return new PostgresJoinRequestNotificationAdapter(options);
  }

  private constructor(private readonly options: PostgresJoinRequestNotificationOptions) {}

  build(): JoinRequestNotificationService {
    return JoinRequestNotificationService.create({
      audience: PrismaJoinRequestAudienceRepository.create(this.options.database),
      mail: this.options.mail,
    });
  }
}

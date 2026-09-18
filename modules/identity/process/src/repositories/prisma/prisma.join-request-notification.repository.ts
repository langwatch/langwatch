import type { JoinRequestMail } from "../../app/identity.members.ts";
import { JoinRequestNotificationService } from "../../services/join-request-notification.service.ts";
import {
  PrismaJoinRequestAudienceRepository,
  type PrismaJoinRequestAudienceDatabase,
} from "./prisma.join-request-audience.repository.ts";

/** Every model a join-request notification reads, and no other. */
export type JoinRequestNotificationDatabase = PrismaJoinRequestAudienceDatabase;

export type PostgresJoinRequestNotificationOptions = {
  /** The composition root's own typed client, handed down with no cast. */
  database: JoinRequestNotificationDatabase;
  /** How the two wake-driven mails are rendered and sent. */
  mail: JoinRequestMail;
};

/**
 * The Postgres composition seam for the join request's wake notifications.
 * Everything behind the audience is plain Postgres; the mail port is the
 * only non-table dependency — the split this seam exists to make.
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

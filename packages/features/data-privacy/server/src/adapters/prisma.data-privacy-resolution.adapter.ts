import type { DataPrivacyProjectPort } from "../ports/data-privacy.port";
import {
  PrismaDataPrivacyPolicyRepository,
  type DataPrivacyDatabase,
} from "../repositories/prisma/prisma.data-privacy.repository";
import { DataPrivacyResolutionService } from "../services/data-privacy-resolution.service";

/** The one model the policy resolution needs from the client. */
export type DataPrivacyResolutionDatabase = DataPrivacyDatabase;

/**
 * The policy a project resolves to, composed from one Prisma client and one
 * project read.
 *
 * A background process that folds spans has to know, per project, which
 * content categories the customer asked to be dropped and which to be
 * redacted. Reaching that through `DataPrivacyService` meant composing an
 * `OrganizationService` — and so an authz service, a grants service and three
 * identity ports — for a question the project's own row already answers.
 *
 * The object it builds satisfies `DataPrivacyResolutionPort`, which is what
 * `OtlpSpanContentDropService` and `PiiRedactionPolicyService` ask for.
 * `DataPrivacyService` satisfies it as well, because it composes this same
 * service and delegates to it, which is what keeps the application's own
 * compositions compiling unchanged and what keeps the two processes resolving
 * from one implementation rather than two.
 */
export class PrismaDataPrivacyResolutionAdapter {
  static create(options: {
    prisma: DataPrivacyResolutionDatabase;
    projects: DataPrivacyProjectPort;
    ttlMs?: number;
    now?: () => number;
  }): DataPrivacyResolutionService {
    return DataPrivacyResolutionService.create({
      repository: PrismaDataPrivacyPolicyRepository.create(options.prisma),
      projects: options.projects,
      ...(options.ttlMs === undefined ? {} : { ttlMs: options.ttlMs }),
      ...(options.now === undefined ? {} : { now: options.now }),
    });
  }
}

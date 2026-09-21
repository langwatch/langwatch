import type { IdentityBackfillRepository } from "./identity-backfill.repository.ts";
import type { IdentityHeadsRepository } from "./identity-heads.repository.ts";
import type { IdentityLatchRepository } from "./identity-latch.repository.ts";
import type { IdentityLookupRepository } from "./identity-lookup.repository.ts";
import type { IdentityNewbornRepository } from "./identity-newborn.repository.ts";
import type { IdentityReservationRepository } from "./identity-reservations.repository.ts";
import type { IdentitySignInAccountsRepository } from "./identity-signin-accounts.repository.ts";
import type { IdentityUsersRepository } from "./identity-users.repository.ts";
import type { IdentityVerificationRepository } from "./identity-verification.repository.ts";
import type {
  JoinCandidateRepository,
  JoinRequestListReadRepository,
} from "./join-request.repository.ts";
import type { MfaEnrollmentRepository } from "./mfa-enrollment.repository.ts";
import type { SsoBreakGlassRepository } from "./sso-break-glass.repository.ts";
import type { SsoConnectionBackofficeRepository } from "./sso-connection-backoffice.repository.ts";
import type {
  SsoConnectionReadRepository,
  SsoConnectionStrandingRepository,
} from "./sso-connection.repository.ts";
import type { SsoDomainReproofTargetRepository } from "./sso-domain-reproof.repository.ts";

/**
 * The rows the identity module owns, chosen once at boot. One tier over
 * Postgres, one over memory; every row is an interface this package states
 * and a backend satisfies, so a guard reads the same head either way.
 */
export interface IdentityRepositories {
  readonly heads: IdentityHeadsRepository;
  readonly latch: IdentityLatchRepository;
  readonly users: IdentityUsersRepository;
  /** The legacy half of the sign-in router's one per-user read (ADR-117). */
  readonly signInAccounts: IdentitySignInAccountsRepository;
  readonly newborn: IdentityNewbornRepository;
  readonly reservations: IdentityReservationRepository;
  readonly verification: IdentityVerificationRepository;
  readonly backfill: IdentityBackfillRepository;
  readonly mfaEnrollment: MfaEnrollmentRepository;
  readonly joinRequests: JoinRequestListReadRepository;
  readonly joinCandidates: JoinCandidateRepository;
  readonly ssoConnections: SsoConnectionReadRepository;
  readonly ssoStranding: SsoConnectionStrandingRepository;
  readonly ssoBackoffice: SsoConnectionBackofficeRepository;
  /** Which proved domains are due a re-read, and the look itself (ADR-123). */
  readonly ssoReproofTargets: SsoDomainReproofTargetRepository;
  /** The ways back in a connection's activation depends on (D05). */
  readonly ssoBreakGlass: SsoBreakGlassRepository;
  /**
   * Optional until `identity.app.ts` and the two aggregate backends wire a
   * concrete instance in (out of this lane's owned paths - see the
   * identity-lookup-server-reads handoff).
   */
  readonly identityLookup?: IdentityLookupRepository;
}

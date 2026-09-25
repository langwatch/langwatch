import type { StateProjectionStore } from "@langwatch/eventing";

import type { IdentityFoldState } from "../eventing/identity-state.projection.ts";
import type { JoinRequestFoldState } from "../eventing/join-request-state.projection.ts";
import type { MfaFoldState } from "../eventing/mfa-enrollment-state.projection.ts";
import type { ScimSyncFoldState } from "../eventing/scim-sync-state.projection.ts";
import type { SsoConnectionFoldState } from "../eventing/sso-connection-state.projection.ts";
import type { IdentitySecretCarryRepository } from "../services/identity-secret-carry.service.ts";
import type { IdentityBackfillRepository } from "./identity-backfill.repository.ts";
import type { IdentityHeadsRepository } from "./identity-heads.repository.ts";
import type { IdentityHistoryRepository } from "./identity-history.repository.ts";
import type { IdentityLatchRepository } from "./identity-latch.repository.ts";
import type { IdentityLookupRepository } from "./identity-lookup.repository.ts";
import type { IdentityNewbornRepository } from "./identity-newborn.repository.ts";
import type { IdentityReservationRepository } from "./identity-reservations.repository.ts";
import type { IdentitySignInAccountsRepository } from "./identity-signin-accounts.repository.ts";
import type { IdentityUsersRepository } from "./identity-users.repository.ts";
import type { IdentityVerificationRepository } from "./identity-verification.repository.ts";
import type { JoinRequestAudienceRepository } from "./join-request-audience.repository.ts";
import type { JoinRequestNotificationContextRepository } from "./join-request-notification-context.repository.ts";
import type {
  JoinCandidateRepository,
  JoinRequestListReadRepository,
} from "./join-request.repository.ts";
import type { MfaEnrollmentRepository } from "./mfa-enrollment.repository.ts";
import type { ScimSyncReadRepository } from "./scim-sync.repository.ts";
import type { SsoBreakGlassRepository } from "./sso-break-glass.repository.ts";
import type { SsoConnectionBackofficeRepository } from "./sso-connection-backoffice.repository.ts";
import type { SsoConnectionRegistrationRepository } from "./sso-connection-registration.repository.ts";
import type {
  SsoConnectionReadRepository,
  SsoConnectionStrandingRepository,
  SsoPlatformOperatorRepository,
} from "./sso-connection.repository.ts";
import type { SsoCredentialRepository } from "./sso-credential.repository.ts";
import type { SsoDomainOwnershipRepository } from "./sso-domain-ownership.repository.ts";
import type { SsoDomainReproofTargetRepository } from "./sso-domain-reproof.repository.ts";
import type { SsoEngineProviderRepository } from "./sso-engine-provider.repository.ts";
import type { SsoMigrationEvidenceRepository } from "./sso-migration-evidence.repository.ts";
import type { SsoRegistrantReadRepository } from "./sso-registrant.repository.ts";
import type { TwoStepVerificationRepository } from "./two-step-verification.repository.ts";

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
  /** The account-level second-factor evidence and the seats it is asked across (D06). */
  readonly twoStepVerification: TwoStepVerificationRepository;
  readonly joinRequests: JoinRequestListReadRepository;
  readonly joinCandidates: JoinCandidateRepository;
  readonly ssoConnections: SsoConnectionReadRepository;
  readonly ssoStranding: SsoConnectionStrandingRepository;
  /** The per-organization registration slots a new connection claims first. */
  readonly ssoRegistrationSlots: SsoConnectionRegistrationRepository;
  readonly ssoBackoffice: SsoConnectionBackofficeRepository;
  /** Which proved domains are due a re-read, and the look itself (ADR-123). */
  readonly ssoReproofTargets: SsoDomainReproofTargetRepository;
  /** Where a connection's identity-provider credentials are kept (D09). */
  readonly ssoCredentials: SsoCredentialRepository;
  /** The engine's provider rows, folded from the connection head (D09). */
  readonly ssoEngineProviders: SsoEngineProviderRepository;
  /** The ways back in a connection's activation depends on (D05). */
  readonly ssoBreakGlass: SsoBreakGlassRepository;
  /** Who an asserted address and a connection subject belong to (ADR-117 §5). */
  readonly ssoRegistrants: SsoRegistrantReadRepository;
  readonly ssoMigrationEvidence: SsoMigrationEvidenceRepository;
  /** The folded heads each identity pipeline writes, under the queue's per-aggregate lock. */
  readonly identityProjection: StateProjectionStore<IdentityFoldState>;
  readonly mfaProjection: StateProjectionStore<MfaFoldState>;
  readonly joinRequestProjection: StateProjectionStore<JoinRequestFoldState>;
  readonly ssoConnectionHeads: StateProjectionStore<SsoConnectionFoldState>;
  /** The directory-sync head and the reads over it (D08). */
  readonly scimSyncs: StateProjectionStore<ScimSyncFoldState> & ScimSyncReadRepository;
  /** The three backfill reads the D01 secret-carry pass writes through. */
  readonly secretCarry: IdentitySecretCarryRepository;
  /** Who a join-request or domain-proof notice reaches. */
  readonly joinRequestAudience: JoinRequestAudienceRepository;
  /** What a join-request mail says beyond names: intent, domain habit, personal teams. */
  readonly joinRequestNotificationContext: JoinRequestNotificationContextRepository;
  /** Who counts as a LangWatch platform operator, by the deployment's `ADMIN_EMAILS`. */
  readonly ssoPlatformOperators: SsoPlatformOperatorRepository;
  /** Which domains a connection owns, re-projected by the ownership backfill. */
  readonly ssoDomainOwnership: SsoDomainOwnershipRepository;
  /** The cross-organization reads the operator identity lookup takes (D05). */
  readonly identityLookup: IdentityLookupRepository;
  /** A person's identity log, read: the lookup's history panel and its waiting proposals. */
  readonly identityHistory: IdentityHistoryRepository;
}

/** The rows a one-shot migration pass reads, none of which needs the deployment's encryption. */
export type IdentityMigrationRepositories = Pick<
  IdentityRepositories,
  | "heads"
  | "users"
  | "reservations"
  | "mfaEnrollment"
  | "identityProjection"
  | "backfill"
  | "secretCarry"
  | "newborn"
  | "ssoDomainOwnership"
>;

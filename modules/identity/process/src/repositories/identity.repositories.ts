import type { StateProjectionStore } from "@langwatch/eventing";

import type { ProvisionalHeadsWriter } from "../eventing/identity-ledger.store.ts";
import type { IdentityFoldState } from "../eventing/identity-state.projection.ts";
import type { JoinRequestFoldState } from "../features/join-request/eventing/join-request-state.projection.ts";
import type { JoinRequestAudienceRepository } from "../features/join-request/repositories/join-request-audience.repository.ts";
import type { JoinRequestNotificationContextRepository } from "../features/join-request/repositories/join-request-notification-context.repository.ts";
import type {
  JoinCandidateRepository,
  JoinRequestListReadRepository,
} from "../features/join-request/repositories/join-request.repository.ts";
import type { MfaFoldState } from "../features/mfa/eventing/mfa-enrollment-state.projection.ts";
import type { MfaEnrollmentRepository } from "../features/mfa/repositories/mfa-enrollment.repository.ts";
import type { TwoStepVerificationRepository } from "../features/mfa/repositories/two-step-verification.repository.ts";
import type { LegacySsoOrganizationRepository } from "../features/sso-arrival/repositories/legacy-sso-organization.repository.ts";
import type { SsoBreakGlassRepository } from "../features/sso-arrival/repositories/sso-break-glass.repository.ts";
import type { SsoMigrationEvidenceRepository } from "../features/sso-arrival/repositories/sso-migration-evidence.repository.ts";
import type { SsoConnectionFoldState } from "../features/sso-connection/eventing/sso-connection-state.projection.ts";
import type { SsoConnectionAdminRepository } from "../features/sso-connection/repositories/sso-connection-admin.repository.ts";
import type { SsoConnectionHistoryRepository } from "../features/sso-connection/repositories/sso-connection-history.repository.ts";
import type { SsoConnectionRegistrationRepository } from "../features/sso-connection/repositories/sso-connection-registration.repository.ts";
import type { SsoConnectionRoutingRepository } from "../features/sso-connection/repositories/sso-connection-routing.repository.ts";
import type {
  SsoConnectionReadRepository,
  SsoConnectionStrandingRepository,
} from "../features/sso-connection/repositories/sso-connection.repository.ts";
import type { SsoCredentialRepository } from "../features/sso-connection/repositories/sso-credential.repository.ts";
import type { SsoEngineProviderRepository } from "../features/sso-connection/repositories/sso-engine-provider.repository.ts";
import type { SsoRegistrantReadRepository } from "../features/sso-connection/repositories/sso-registrant.repository.ts";
import type { SsoDomainOwnershipRepository } from "../features/sso-domain/repositories/sso-domain-ownership.repository.ts";
import type { SsoDomainReproofTargetRepository } from "../features/sso-domain/repositories/sso-domain-reproof.repository.ts";
import type { IdentityAccounts, IdentityResolver } from "../rules/identity-storage.rules.ts";
import type { IdentitySecretCarryRepository } from "../services/identity-secret-carry.service.ts";
import type { IdentityAccountRekeyRepository } from "./identity-account-rekey.repository.ts";
import type { IdentityBackfillRepository } from "./identity-backfill.repository.ts";
import type { IdentityConnectionIssuersRepository } from "./identity-connection-issuers.repository.ts";
import type { IdentityHeadsRepository } from "./identity-heads.repository.ts";
import type { IdentityHistoryRepository } from "./identity-history.repository.ts";
import type { IdentityLatchRepository } from "./identity-latch.repository.ts";
import type { IdentityLookupRepository } from "./identity-lookup.repository.ts";
import type { IdentityMigrationRepository } from "./identity-migration.repository.ts";
import type { IdentityPasskeyRemovalRepository } from "./identity-passkey-removal.repository.ts";
import type { IdentityRateLimitRepository } from "./identity-rate-limit.repository.ts";
import type { IdentityReservationRepository } from "./identity-reservations.repository.ts";
import type { IdentitySignInAccountsRepository } from "./identity-signin-accounts.repository.ts";
import type { IdentityUsersRepository } from "./identity-users.repository.ts";
import type { IdentityVerificationRepository } from "./identity-verification.repository.ts";

/**
 * The rows the identity module owns, chosen once at boot. One tier over
 * Postgres, one over memory; every row is an interface this package states
 * and a backend satisfies, so a guard reads the same head either way.
 */
export interface IdentityRepositories {
  readonly heads: IdentityHeadsRepository;
  readonly latch: IdentityLatchRepository;
  /** The identity branch of better-auth's storage adapter (ADR-116 §1, §6). */
  readonly accounts: IdentityAccounts;
  readonly resolution: IdentityResolver;
  readonly connectionIssuers: IdentityConnectionIssuersRepository;
  readonly passkeyRemoval: IdentityPasskeyRemovalRepository;
  readonly users: IdentityUsersRepository;
  /** The legacy half of the sign-in router's one per-user read (ADR-117). */
  readonly signInAccounts: IdentitySignInAccountsRepository;
  /** The pre-3.17 Microsoft account key move a sign-in makes before better-auth's lookup. */
  readonly accountRekey: IdentityAccountRekeyRepository;
  readonly reservations: IdentityReservationRepository;
  readonly verification: IdentityVerificationRepository;
  readonly backfill: IdentityBackfillRepository;
  readonly mfaEnrollment: MfaEnrollmentRepository;
  /** The account-level second-factor evidence and the seats it is asked across (D06). */
  readonly twoStepVerification: TwoStepVerificationRepository;
  readonly joinRequests: JoinRequestListReadRepository;
  readonly joinCandidates: JoinCandidateRepository;
  readonly ssoConnections: SsoConnectionReadRepository;
  /** The connections sign-in routing reads by domain, and the live set (ADR-117 §5). */
  readonly ssoConnectionRouting: SsoConnectionRoutingRepository;
  /** The legacy domain columns the router falls back to (ADR-117 §5). */
  readonly legacySsoOrganizations: LegacySsoOrganizationRepository;
  readonly ssoStranding: SsoConnectionStrandingRepository;
  /** The per-organization registration slots a new connection claims first. */
  readonly ssoRegistrationSlots: SsoConnectionRegistrationRepository;
  readonly ssoAdmin: SsoConnectionAdminRepository;
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
  readonly identityProjection: StateProjectionStore<IdentityFoldState> & ProvisionalHeadsWriter;
  readonly mfaProjection: StateProjectionStore<MfaFoldState>;
  readonly joinRequestProjection: StateProjectionStore<JoinRequestFoldState>;
  readonly ssoConnectionHeads: StateProjectionStore<SsoConnectionFoldState>;
  /** The three backfill reads the D01 secret-carry pass writes through. */
  readonly secretCarry: IdentitySecretCarryRepository;
  /** The frozen SQL behind identity's declared migration steps. */
  readonly migration: IdentityMigrationRepository;
  /** Who a join-request or domain-proof notice reaches. */
  readonly joinRequestAudience: JoinRequestAudienceRepository;
  /** What a join-request mail says beyond names: intent, domain habit, personal teams. */
  readonly joinRequestNotificationContext: JoinRequestNotificationContextRepository;
  /** Which domains a connection owns, re-projected by the ownership backfill. */
  readonly ssoDomainOwnership: SsoDomainOwnershipRepository;
  /** The cross-organization reads the operator identity lookup takes (D05). */
  readonly identityLookup: IdentityLookupRepository;
  /** Identity's throttles: join requests, confirmation mails and the lookup's attempt budget. */
  readonly rateLimits: IdentityRateLimitRepository;
  /** A person's identity log and the link proposals folded from it (WEB-9103). */
  readonly identityHistory: IdentityHistoryRepository;
  /** A connection's log, read as its history panel (WEB-9103). */
  readonly ssoConnectionHistory: SsoConnectionHistoryRepository;
}

/**
 * The identity runtime: THE composition root (ADR-115 §4). The one place
 * Prisma, the migration-state table and the event-sourcing pipeline handle
 * meet `@langwatch/identity-server`'s services. Nothing else constructs an
 * IdentityService, a guard, or a ceremony; a consumer imports the composed
 * instance from here or is wrong.
 *
 * Only server-only modules may import this file: its graph reaches
 * `~/server/db` at module scope. Every environment read the services need
 * is a closure passed from here — the packages read no env of their own.
 */

import { PlanTypes } from "@ee/billing/planTypes";
import { platformSSOAllowed } from "@ee/sso/sso-gate";
import type { SignInDomainRoutingPort } from "@langwatch/identity-server";
import {
  IdentityBackfillService,
  IdentityEmailService,
  IdentityGuards,
  IdentitySecretCarryService,
  IdentityService,
  JoinRequestGuards,
  JoinRequestService,
  LinkProposalGuards,
  LinkProposalService,
  MfaGuards,
  MfaService,
  newIdentityCommandId,
  ShadowComparingDomainRoutingRepository,
  SignInRouterService,
  SsoConnectionGrandfatherService,
  SsoConnectionGuards,
  SsoConnectionService,
  VerificationCeremonyService,
} from "@langwatch/identity-server";
import type { IdentityAccountCeremonies } from "@langwatch/identity-server/better-auth";
import {
  birthAwareGate,
  bridgeAccountCeremonies,
  createIdentityStorageAdapter,
  IdentityAccountWriter,
  IdentityCeremonies,
  MfaCeremonies,
} from "@langwatch/identity-server/better-auth";
import { RedisConfigService } from "@langwatch/redis-client";
import { compare, hash } from "bcrypt";
import type { BetterAuthOptions } from "better-auth";
import type { AdapterFactory } from "better-auth/adapters";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nanoid } from "nanoid";
import { env } from "~/env.mjs";
import type { PrismaClient } from "~/generated/prisma/client";
import { changeAuth0Password } from "../../auth0/passwordService";
import {
  BORN_FINALIZED_SIGNUP_FLAG,
  BornFinalizedOptIn,
} from "../../better-auth/bornFinalizedOptIn";
import type { SecondaryStorageDeps } from "../../better-auth/config/secondary-storage";
import { LastWayInGuard } from "../../better-auth/last-way-in";
import { PasskeySignUpRegistration } from "../../better-auth/passkey-signup";
import { PasswordResetSessionBridge } from "../../better-auth/password-reset-session";
import { BetterAuthSessionMinter } from "../../better-auth/session-minter";
import { SignUpConfirmationEndpoint } from "../../better-auth/sign-up-confirmation";
import { prisma } from "../../db";
import { featureFlagService } from "../../featureFlag";
import { NOT_TARGETED } from "../../featureFlag/targeting";
import { sendAddressConfirmationEmail } from "../../mailer/addressConfirmationEmail";
import { sendSignUpVerificationEmail } from "../../mailer/signUpVerificationEmail";
import { trackServerEvent } from "../../posthog";
import { getApp, tryGetApp } from "../app";
import { grantsLedgerWriter } from "../authz/ledger";
import { PrismaSystemMigrationStateRepository } from "../system-migrations/repositories/system-migration-state.prisma.repository";
import { AccountIdentifiersService } from "./account-identifiers.service";
import { buildAddressConfirmationUrl } from "./address-confirmation-link";
import { BetterAuthInstanceHandle } from "./better-auth-instance.adapter";
import { IdentityBirthService } from "./birth";
import { LocalDoorBreakGlassBinding } from "./break-glass-binding";
import { InProcessBreakGlassLimiter } from "./break-glass-limiter";
import { IdentitySsoConnectionGrandfatherMigration } from "./connection-grandfather.migration";
import { CredentialAccountService } from "./credential-account.service";
import { CredentialAccountStorageAdapter } from "./credential-account.storage-adapter";
import { IdentityIdentifierBackfillMigration } from "./identifier-backfill.migration";
import { IdentityLookupService } from "./identity-lookup.service";
import {
  BetterAuthLinkProposalDirectory,
  BetterAuthOperatorSessions,
  InviteServiceOperatorInvitations,
} from "./identity-lookup-adapters";
import {
  EmailJoinRequestNotifier,
  PrismaJoinMembership,
  PrismaJoinSettings,
} from "./join-request-adapters";
import { JoinRequestLedgerWriter } from "./join-request-ledger";
import { JoinRequestsService } from "./join-requests.service";
import { LastWayInService } from "./last-way-in.service";
import { IdentityLedgerWriter } from "./ledger";
import { MfaLedgerWriter } from "./mfa-ledger";
import { IdentityNewbornReconciliationService } from "./newborn-reconciliation";
import { OrganizationMfaService } from "./organization-mfa.service";
import {
  LoggingOrganizationMfaNotifier,
  PrismaOrganizationConnectionFactors,
  PrismaOrganizationMemberFactors,
  PrismaOrganizationMfaSettings,
  PrismaSessionFactors,
} from "./organization-mfa-adapters";
import { AdminEmailPlatformOperators } from "./platform-operators";
import { PrismaCredentialAccountRepository } from "./repositories/credential-account.prisma.repository";
import { PrismaIdentityAccountsRepository } from "./repositories/identity-accounts.prisma.repository";
import { PrismaIdentityBackfillRepository } from "./repositories/identity-backfill.prisma.repository";
import { EventLogIdentityRepository } from "./repositories/identity-event-log.repository";
import { PrismaIdentityHeadsRepository } from "./repositories/identity-heads.prisma.repository";
import { PrismaIdentityLookupRepository } from "./repositories/identity-lookup.prisma.repository";
import { PrismaIdentityNewbornRepository } from "./repositories/identity-newborn.prisma.repository";
import { PrismaIdentityProjectionRepository } from "./repositories/identity-projection.prisma.repository";
import { PrismaIdentityReservationRepository } from "./repositories/identity-reservations.prisma.repository";
import { PrismaIdentityResolutionRepository } from "./repositories/identity-resolution.prisma.repository";
import { PrismaIdentitySecretCarryRepository } from "./repositories/identity-secret-carry.prisma.repository";
import { PrismaIdentityUsersRepository } from "./repositories/identity-users.prisma.repository";
import { PrismaIdentityVerificationRepository } from "./repositories/identity-verification.prisma.repository";
import {
  PrismaJoinCandidateRepository,
  PrismaJoinRequestReadRepository,
} from "./repositories/join-request.prisma.repository";
import { PrismaJoinRequestProjectionRepository } from "./repositories/join-request-projection.prisma.repository";
import { PrismaLastWayInRepository } from "./repositories/last-way-in.prisma.repository";
import { LegacySsoDomainRoutingRepository } from "./repositories/legacy-sso-domain.prisma.repository";
import { PrismaLegacySsoOrganizationRepository } from "./repositories/legacy-sso-organization.prisma.repository";
import { PrismaMfaEnrollmentRepository } from "./repositories/mfa-enrollment.prisma.repository";
import { PrismaMfaEnrollmentProjectionRepository } from "./repositories/mfa-enrollment-projection.prisma.repository";
import { PrismaPasskeyRemovalRepository } from "./repositories/passkey-removal.prisma.repository";
import { PrismaSignUpHealthRepository } from "./repositories/sign-up-health.prisma.repository";
import {
  PrismaSignUpAccountDirectory,
  PrismaSignUpVerificationTokenStore,
} from "./repositories/signup-verification.prisma.repository";
import { PrismaSsoConnectionProjectionRepository } from "./repositories/sso-connection-projection.prisma.repository";
import {
  PrismaSsoConnectionReadRepository,
  PrismaSsoConnectionStrandingRepository,
} from "./repositories/sso-connection-reads.prisma.repository";
import { SsoConnectionDomainRoutingRepository } from "./repositories/sso-connection-routing.prisma.repository";
import { IdentitySecretHealMigration } from "./secret-heal.migration";
import {
  PrismaSessionIdentifiers,
  PrismaSessionRecords,
  PrismaSessionRevocationRecords,
  RedisSessionCache,
  RedisSessionRevocationCache,
  VerifiedCallbackProviderAssertions,
} from "./session-adapters";
import { SessionClaimsService } from "./session-claims.service";
import { SessionInventoryService } from "./session-inventory.service";
import { SessionRevocationService } from "./session-revocation.service";
import { SignUpHealthService } from "./sign-up-health.service";
import { SignUpIdentifierService } from "./sign-up-identifier";
import { ProjectionSignInAccountLookup } from "./signin-account-lookup";
import {
  deploymentOffersTwoStepVerification,
  resolveFederatedMethod,
  signInMethodPolicyPort,
} from "./signin-method-policy";
import { SignUpVerificationService } from "./signup-verification.service";
import { buildSignUpVerificationUrl } from "./signup-verification-link";
import { SsoConnectionLedgerWriter } from "./sso-connection-ledger";
import { PrismaTwoStepAccount } from "./two-step-account.adapter";
import { TwoStepVerificationService } from "./two-step-verification.service";
import { BetterAuthTwoStepProtocol } from "./two-step-verification-adapters";
import {
  forgetIdentityWriteGate,
  isAnyoneOnIdentityWrites,
  isUserOnIdentityWrites,
} from "./write-gate";

/**
 * The method-set policy, re-stated on the runtime because the runtime is the
 * app's ONE door into app-layer identity (ADR-115) — and better-auth is the
 * caller the boundary test names. It composes nothing: these are policy
 * functions over the SSO gate and env, and they are exposed here rather than
 * imported sideways so `better-auth/` keeps a single identity import.
 */
export {
  deploymentIsFederationCapable,
  resolveSignInMethodPolicy,
} from "./signin-method-policy";

const identityHeads = new PrismaIdentityHeadsRepository(prisma);
const identityUsers = new PrismaIdentityUsersRepository(prisma);
const identityAccounts = new PrismaIdentityAccountsRepository(prisma);
const identityResolution = new PrismaIdentityResolutionRepository(prisma);
const identityNewborns = new PrismaIdentityNewbornRepository(prisma);
/** The address lock (ADR-116 §6): one constraint, contended by the guards and
 *  the born-finalized entrance alike. */
const identityReservations = new PrismaIdentityReservationRepository(prisma);
const migrationState = new PrismaSystemMigrationStateRepository(prisma);

/** The per-user fork as the services take it: one closure, one state
 *  repository, composed here rather than defaulted inside a service. The
 *  SAME predicate forks the ceremonies' writes and the email read — ADR-110's
 *  one switch, re-tenanted to users. */
export function isLatched({ userId }: { userId: string }): Promise<boolean> {
  return isUserOnIdentityWrites({ userId, state: migrationState });
}

/** The same question asked of the FLEET, for an `account` query that names
 *  no user (ADR-116 §7). */
export function isAnyoneLatched(): Promise<boolean> {
  return isAnyoneOnIdentityWrites({ state: migrationState });
}

/**
 * The write fork the storage adapter uses, birth-aware — and therefore the
 * one question the `databaseHooks` bridge has to ask before it states an
 * attach the adapter is about to state as well (ADR-116 §5).
 */
export const routesToIdentityBranch = birthAwareGate(isLatched);

/**
 * The read fork for `User.email`. A module-level singleton rather than a
 * per-call composition: it holds no request state, and the session boundary
 * resolves it on every authenticated request.
 */
const identityEmailService = new IdentityEmailService(identityHeads, isLatched);

export function identityEmail(): IdentityEmailService {
  return identityEmailService;
}

/**
 * The write surface. Composed per call like `grantsService()`: the ledger
 * writer resolves the pipeline handle lazily, so a ceremony composed before
 * the App exists (better-auth builds its options at module load) still
 * appends once one does.
 */
export function identityService(): IdentityService {
  return new IdentityService(
    identityGuards(),
    new IdentityLedgerWriter({
      projectionStore: identityProjectionStore(),
      heads: identityHeads,
    }),
  );
}

/** The guards, over all three of their repositories (ADR-116 §6). */
export function identityGuards(): IdentityGuards {
  return new IdentityGuards(identityHeads, identityUsers, identityReservations);
}

/** The fold's store, which also releases the address locks a user stops
 *  holding — composed here so both the pipeline and the ledger's wait read the
 *  same instance shape. */
export function identityProjectionStore(): PrismaIdentityProjectionRepository {
  return new PrismaIdentityProjectionRepository(prisma, identityReservations);
}

export function verificationCeremony(): VerificationCeremonyService {
  return new VerificationCeremonyService(
    new PrismaIdentityVerificationRepository(prisma),
    identityHeads,
    identityService(),
    { isLatched },
  );
}

/** Both pass-time directions of the bridge mirror's row half (ADR-116 §4):
 *  the latch's one-time carry, and the reverse heal. */
const identitySecretCarryService = new IdentitySecretCarryService(
  new PrismaIdentitySecretCarryRepository(prisma),
);

export function identitySecretCarry(): IdentitySecretCarryService {
  return identitySecretCarryService;
}

/**
 * The account's own sign-in addresses (the authentication settings surface).
 *
 * Composed per call like the write surface it uses, and given its mailer and
 * link builder as closures rather than importing them itself: the service is
 * the app's, but it holds no env and renders no mail.
 */
export function accountIdentifiers(): AccountIdentifiersService {
  return new AccountIdentifiersService({
    heads: identityHeads,
    identity: identityService(),
    ceremony: verificationCeremony(),
    deps: {
      sendConfirmation: sendAddressConfirmationEmail,
      buildConfirmationUrl: buildAddressConfirmationUrl,
      newCommandId: newIdentityCommandId,
      now: () => Date.now(),
    },
  });
}

export function identityBackfill(): IdentityBackfillService {
  return new IdentityBackfillService(
    new PrismaIdentityBackfillRepository(prisma),
    identityUsers,
    identityService(),
    identitySecretCarryService,
  );
}

/** The D01 backfill as the migrations runtime registers it (tenant = user). */
export function identifierBackfillMigration(): IdentityIdentifierBackfillMigration {
  return new IdentityIdentifierBackfillMigration(identityBackfill());
}

/** The reverse mirror's heal leg, as its own never-terminal pass — see the
 *  migration's own docblock for why it cannot be a step in the backfill. */
export function identitySecretHealMigration(): IdentitySecretHealMigration {
  return new IdentitySecretHealMigration(identitySecretCarryService);
}

/**
 * What better-auth's own `databaseHooks` call (ADR-101 §2): three methods
 * bound to `account.create.before`, `account.delete.before` and
 * `user.delete.before` in `server/better-auth/index.ts`, every one of which
 * returns having done nothing for a user whose backfill has not finalized.
 * The gate ships closed, so wiring them changes nothing on its own.
 */
export function identityCeremonies(): IdentityCeremonies {
  return new IdentityCeremonies(
    identityHeads,
    identityUsers,
    identityService(),
    // The ceremonies fork on the SAME question the storage adapter does, so
    // they take the same birth-aware gate (ADR-116 §3). A newborn whose
    // adapter routed to the identity branch while their ceremony declined
    // would end up with a legacy `Account` row anyway, which is exactly what
    // the entrance exists to prevent.
    birthAwareGate(isLatched),
    { now: Date.now, newCommandId: newIdentityCommandId },
  );
}

/**
 * The two account ceremonies as `databaseHooks` bind them (ADR-116 §5): the
 * SAME instances, deferring for every user the storage adapter routes to the
 * identity branch, because the adapter states those facts itself and a second
 * statement in the same request appends the event twice.
 */
export function identityBridgeCeremonies(): Pick<
  IdentityAccountCeremonies,
  "beforeAccountCreate" | "beforeAccountDelete"
> {
  return bridgeAccountCeremonies({
    ceremonies: identityCeremonies(),
    routesToIdentity: routesToIdentityBranch,
  });
}

/**
 * ADR-116 §3's born-finalized entrance. Composed per call like every other
 * identity write surface, because the ledger writer it sequences resolves
 * the pipeline handle lazily — better-auth builds its adapter at module
 * load, before any App exists.
 */
export function identityBirth(): IdentityBirthService {
  return new IdentityBirthService({
    guards: identityGuards(),
    ledger: new IdentityLedgerWriter({
      projectionStore: identityProjectionStore(),
      heads: identityHeads,
    }),
    rows: identityNewborns,
    reservations: identityReservations,
    forgetGate: forgetIdentityWriteGate,
  });
}

/**
 * The break-glass budget is per PROCESS, so it is a module singleton — a
 * per-call limiter would count to one forever and limit nothing.
 */
const breakGlassLimiter = new InProcessBreakGlassLimiter();

const legacySsoDomainRouting = new LegacySsoDomainRoutingRepository(
  prisma,
  resolveFederatedMethod,
);

/**
 * The projection-backed domain lookup (D04). `configured` still means what it
 * meant before the aggregate existed: whether this deployment actually
 * mounted the method the connection names.
 */
const ssoConnectionDomainRouting = new SsoConnectionDomainRoutingRepository(
  prisma,
  async (methodId) => (await resolveFederatedMethod())?.id === methodId,
);

/**
 * Which lookup the router gets (ADR-117 §5). Keep the current rollout switch
 * and legacy string-backed read path in this slice; the connection-first
 * cutover belongs to the SSO rollout.
 */
export function signInDomainRoutingPort(): SignInDomainRoutingPort {
  switch (env.SSOCONN_ROUTING) {
    case "enforce":
      return ssoConnectionDomainRouting;
    case "shadow":
      return new ShadowComparingDomainRoutingRepository({
        deciding: legacySsoDomainRouting,
        shadow: ssoConnectionDomainRouting,
      });
    default:
      return legacySsoDomainRouting;
  }
}

/**
 * The identifier-first sign-in router (D03, ADR-117), composed here from its
 * ports: the selected domain lookup, the instance method
 * policy that owns ADR-027's frozen license gate, and — since the revision of
 * 2026-08-25 — what the submitted address's account holds.
 *
 * A singleton rather than a per-call composition: it holds no request state,
 * and the break-glass budget above must not be reset by composing it again.
 * The flag is read once, here, for the same reason ADR-027's license gate is
 * a per-process memo — a front door that changes which store it reads
 * mid-flight is not something anyone can reason about during an incident.
 */
const signInRouterService = new SignInRouterService({
  domains: signInDomainRoutingPort(),
  policy: signInMethodPolicyPort,
  breakGlass: breakGlassLimiter,
  accounts: new ProjectionSignInAccountLookup(
    identityHeads,
    identityUsers,
    isLatched,
  ),
});

export function signInRouter(): SignInRouterService {
  return signInRouterService;
}

/**
 * The SSO connection write surface (D04, ADR-117 §5). Composed per call like
 * the identity write surface: the ledger writer resolves the pipeline handle
 * lazily, so a command composed before the App exists still appends once one
 * does.
 *
 * This is the ONLY way a connection changes. Ops actions, the grandfather
 * migration and D05's self-service all call these verbs; nothing writes an
 * `SsoConnection` row, because the row is a projection of this log.
 */
export function ssoConnections(): SsoConnectionService {
  return new SsoConnectionService(
    new SsoConnectionGuards({
      connections: new PrismaSsoConnectionReadRepository(prisma),
      breakGlass: new LocalDoorBreakGlassBinding(),
      stranding: new PrismaSsoConnectionStrandingRepository(prisma),
      platformOperators: new AdminEmailPlatformOperators(identityUsers),
    }),
    new SsoConnectionLedgerWriter({
      projectionStore: new PrismaSsoConnectionProjectionRepository(prisma),
    }),
  );
}

/**
 * The join-request write surface (D12, ADR-117). Composed per call like the
 * two above: the ledger writer resolves the pipeline handle lazily, so a
 * command composed before the App exists still appends once one does.
 *
 * This is the ONLY way a request changes. The sign-up interstitial, the
 * members panel, the auto-join policy and the expiry wake all call these
 * verbs; nothing writes a `JoinRequest` row, because the row is a projection
 * of this log.
 */
export function joinRequests(): JoinRequestService {
  return new JoinRequestService(
    new JoinRequestGuards({
      requests: new PrismaJoinRequestReadRepository(prisma),
    }),
    new JoinRequestLedgerWriter({
      projectionStore: new PrismaJoinRequestProjectionRepository(prisma),
    }),
  );
}

/**
 * Everything AROUND the lifecycle: matching, the reveal discipline, the rate
 * limits, the notifications, and how an approval becomes a membership.
 *
 * `autoJoinLicensed` and `enabled` arrive as closures rather than as reads
 * inside the service, for the reason every other seam here does: the packages
 * read no env, and the licence asymmetry — the gate holds `auto` and lets
 * `request` through — is a decision this composition root states once.
 */
export function joinRequestsService(): JoinRequestsService {
  return new JoinRequestsService({
    requests: joinRequests(),
    reads: new PrismaJoinRequestReadRepository(prisma),
    candidates: new PrismaJoinCandidateRepository(prisma),
    membership: new PrismaJoinMembership(prisma, grantsLedgerWriter()),
    notifier: new EmailJoinRequestNotifier(prisma),
    settings: new PrismaJoinSettings(prisma),
    // The licence asymmetry, stated once: the gate that has always held
    // single sign-on holds AUTOMATIC joining, because that is federation —
    // the deployment decides who counts as a colleague and admits them with
    // nobody in the loop. Asking to join is not gated and never reads this,
    // which is what keeps "my company is invisible" fixed on precisely the
    // self-hosted deployments that have no other way out.
    autoJoinLicensed: () => platformSSOAllowed(),
    enabled: ({ userId }) =>
      featureFlagService.isEnabled("join_requests", {
        distinctId: userId,
        projectId: NOT_TARGETED,
        organizationId: NOT_TARGETED,
      }),
  });
}

/**
 * The orphaned-organization rate (D12), for the operator surface.
 *
 * Composed off the same Prisma client everything else here uses, and reading
 * only tables that have been written all along — which is what lets an
 * operator ask about a window that closed before this deliverable existed.
 */
export function signUpHealth(): SignUpHealthService {
  return new SignUpHealthService({
    repository: new PrismaSignUpHealthRepository(prisma),
  });
}

/**
 * How many backup codes a set holds (D06).
 *
 * Stated here rather than left to the two-factor plugin's default, because
 * two places need the same number and one of them is not the plugin: the
 * plugin issues the codes, and the `MfaEnrollment` aggregate records HOW MANY
 * were issued so "how many are left" can be answered from the log without the
 * log ever knowing a code. A default that drifted would make that count a
 * lie.
 */
export const BACKUP_CODE_COUNT = 10;

/**
 * The two-step verification write surface (D06). The ONLY way an
 * `MfaEnrollment` fact comes into being.
 *
 * Composed per call like the identity write surface: the ledger writer
 * resolves the pipeline handle lazily, so a ceremony composed before the App
 * exists — and better-auth builds its options at module load — still appends
 * once one does.
 */
export function mfaEnrollments(): MfaService {
  return new MfaService(
    new MfaGuards(new PrismaMfaEnrollmentRepository(prisma)),
    new MfaLedgerWriter({
      projectionStore: new PrismaMfaEnrollmentProjectionRepository(prisma),
    }),
  );
}

/**
 * What better-auth's two-factor ENDPOINTS call (D06): the lifecycle fact each
 * completed call implies.
 *
 * Endpoint hooks rather than database hooks, because better-auth's
 * `databaseHooks` do not fire for a plugin's own tables — a `TwoFactor` row
 * appearing is invisible to the identity ceremonies that handle `Account` and
 * `User`, which is why the aggregate had no writer at all until now.
 *
 * Nothing on it can see a secret or a code: the commands it dispatches have
 * no field for one.
 */
export function mfaCeremonies(): MfaCeremonies {
  return new MfaCeremonies({
    mfa: mfaEnrollments(),
    enrollments: new PrismaMfaEnrollmentRepository(prisma),
    backupCodeCount: BACKUP_CODE_COUNT,
    now: Date.now,
  });
}

/**
 * Which of a user's organizations require a second factor (D06).
 *
 * Composed here because better-auth asks it while deciding whether a session
 * may proceed, and the boundary test holds that better-auth reaches app-layer
 * identity through this file or not at all. A direct import of the adapter
 * would be the first exception to that, for a read that has a composition
 * root already.
 */
export function twoStepAccount(): PrismaTwoStepAccount {
  return new PrismaTwoStepAccount(prisma);
}

/**
 * The organization's membership condition and its enrollment gate (D06).
 *
 * There is deliberately no session port in these dependencies. Turning the
 * requirement on ends no session, and the way that stays true through every
 * later edit is that this composition hands the service nothing it could end
 * one with.
 */
export function organizationMfa(): OrganizationMfaService {
  return new OrganizationMfaService({
    settings: new PrismaOrganizationMfaSettings(prisma),
    sessions: new PrismaSessionFactors(prisma),
    members: new PrismaOrganizationMemberFactors(prisma),
    connections: new PrismaOrganizationConnectionFactors(prisma),
    notifier: new LoggingOrganizationMfaNotifier(),
    // Stated once, here, like every other environment read this root owns.
    offered: deploymentOffersTwoStepVerification,
    // The plan, resolved the one way the app resolves plans: the provider
    // that answers for a subscription row on Cloud and for a signed license
    // self-hosted. Read per call rather than captured, so an organization
    // that upgrades this morning can turn the requirement on this morning.
    entitled: async ({ organizationId }) =>
      (await getApp().planProvider.getActivePlan({ organizationId })).type ===
      PlanTypes.ENTERPRISE,
  });
}

/**
 * What a session records at mint (D06): which sign-in method minted it, and
 * what that sign-in proved.
 *
 * Composed here like everything else, and reached from better-auth's own
 * `databaseHooks.session.create.before`. There is no write port on it: it
 * answers claims for a row better-auth is about to create, and nothing in it
 * can create, change or end a session of its own.
 */
const verifiedCallbackProviderAssertions =
  new VerifiedCallbackProviderAssertions();

export function sessionCallbackEvidence(): VerifiedCallbackProviderAssertions {
  return verifiedCallbackProviderAssertions;
}

export function sessionClaims(): SessionClaimsService {
  return new SessionClaimsService({
    identifiers: new PrismaSessionIdentifiers(prisma),
    assertions: verifiedCallbackProviderAssertions,
  });
}

/**
 * Somebody's own signed-in sessions, and per-identifier revocation (D06).
 *
 * The revocation here is NARROW by construction: the only delete it can
 * perform names a person and one of their sign-in methods. Nothing on it can
 * end every session, which stays the password reset's move alone.
 */
export function sessionInventory(): SessionInventoryService {
  return new SessionInventoryService({
    records: new PrismaSessionRecords(prisma),
    cache: new RedisSessionCache(),
  });
}

/**
 * Ending somebody else's sessions: the whole set, every one but the tab
 * asking, the ones one sign-in method minted, or a single named one.
 *
 * The WIDE instrument, and the counterpart to {@link sessionInventory} rather
 * than a replacement for it — a password reset, a deactivation and a seat
 * revocation all reach for this one, and none of them is somebody managing
 * their own devices.
 *
 * Takes a client so a caller that already holds one — the user service, the
 * organization repository — revokes through this service instead of keeping a
 * second copy of the queries. Production hands in the same client this module
 * holds; a test hands in its own.
 */
export function sessionRevocation({
  prisma: client = prisma,
}: {
  prisma?: PrismaClient;
} = {}): SessionRevocationService {
  return new SessionRevocationService({
    records: new PrismaSessionRevocationRecords(client),
    cache: new RedisSessionRevocationCache(),
  });
}

/** The D04 grandfather as the migrations runtime registers it (tenant =
 *  organization). Its proof reads through the two ROUTING ports rather than
 *  the projection directly — a proof that asked the store instead of the port
 *  would pass while the port that actually decides sign-in was miswired. */
export function connectionGrandfatherMigration(): IdentitySsoConnectionGrandfatherMigration {
  return new IdentitySsoConnectionGrandfatherMigration(
    new SsoConnectionGrandfatherService({
      connections: ssoConnections(),
      legacy: new PrismaLegacySsoOrganizationRepository(prisma),
      legacyRouting: legacySsoDomainRouting,
      connectionRouting: ssoConnectionDomainRouting,
      idpMetadataFor: ({ ssoProvider }) => ({
        // The legacy columns carry a provider NAME and nothing else: the
        // endpoints and credentials are the deployment's own env, which is
        // why grandfathered metadata is a reference to the mounted provider
        // rather than an invented issuer. D05's onboarding fills the rest in
        // when a human next edits the connection.
        issuer: null,
        providerId: ssoProvider,
        clientIdRef: null,
        secretRef: null,
        certRefs: [],
      }),
    }),
  );
}

/**
 * The identifier a password sign-up owes (ADR-117 §6), composed per call like
 * every other identity write surface — the ledger it commits through resolves
 * the pipeline handle lazily, so it must not be built at module load.
 */
export function signUpIdentifier(): SignUpIdentifierService {
  return new SignUpIdentifierService(identityService());
}

/**
 * Sign-up's address confirmation (D13, ADR-117 §6). Composed per call like
 * the write surface above: it reaches the mailer, and the mailer is the one
 * dependency a test routinely replaces.
 */
export function signUpVerification(): SignUpVerificationService {
  return new SignUpVerificationService({
    tokens: new PrismaSignUpVerificationTokenStore(prisma),
    directory: new PrismaSignUpAccountDirectory(prisma),
    mailer: {
      sendVerificationLink: ({ email, verificationUrl }) =>
        sendSignUpVerificationEmail({ email, verificationUrl }),
    },
    accounts: {
      // Nobody has been asked for a name on this path: the person typed an
      // address and a password into a log-in form, and the service writes the
      // address in its place, the same as `user.register`. The credential
      // identifier is stated by the same call — the front door reads the
      // projection, so an account with no identifier is an account the door
      // says does not exist, and this path's whole purpose is to hand somebody
      // an account they can immediately sign in to.
      createCredentialAccount: async ({ email, passwordHash }) => {
        await credentialAccounts().openCredentialAccount({
          name: null,
          email,
          passwordHash,
        });
      },
      markAddressConfirmed: async ({ email }) => {
        await identityUsers.updateAddressConfirmed({ email });
      },
    },
    buildVerificationUrl: ({ token }) => buildSignUpVerificationUrl(token),
  });
}

/**
 * The sweep that removes abandoned newborn streams — a required companion to
 * the entrance, not optional hygiene (ADR-116 §3).
 */
export function identityNewbornReconciliation(): IdentityNewbornReconciliationService {
  return new IdentityNewbornReconciliationService({
    newborns: identityNewborns,
    identity: identityService(),
    reservations: identityReservations,
  });
}

/**
 * better-auth's whole `database:` entry (ADR-116 §1): the identity storage
 * adapter, composed here like every other identity collaborator.
 *
 * The legacy branch is better-auth's own published Prisma engine rather than
 * a re-implementation, so an unlatched user's storage traffic is
 * byte-for-byte what it has always been — and the gate ships closed, which
 * makes that every user until an operator enrolls one.
 *
 * Built once, at module load, because `betterAuth()` is: the ceremonies it
 * carries resolve the pipeline handle lazily, so an adapter composed before
 * the App exists still appends once one does.
 */
const identityStorage = createIdentityStorageAdapter({
  legacyEngine: prismaAdapter(prisma, { provider: "postgresql" }),
  passkeyRemoval: PrismaPasskeyRemovalRepository.create({
    prisma,
    routesToIdentity: routesToIdentityBranch,
  }),
  accounts: identityAccounts,
  resolution: identityResolution,
  ceremonies: identityCeremonies(),
  isUserOnIdentityWrites: isLatched,
  isAnyoneOnIdentityWrites: isAnyoneLatched,
  birth: identityBirth(),
});

export function identityStorageAdapter(): AdapterFactory<BetterAuthOptions> {
  return identityStorage;
}

/**
 * The better-auth boundary tier (ADR-129): the plugins, the guards and the
 * session minter, composed here like every other identity collaborator so
 * none of them opens the database itself.
 *
 * EVERY INSTANCE IS BUILT INSIDE ITS FACTORY, not at module scope, and that
 * is load-bearing rather than a style. These classes live under
 * `server/better-auth/`, whose modules import this file back for their thin
 * exports — a genuine cycle, and whichever side loads first the other's
 * classes are still in their temporal dead zone while this module's body
 * runs. Constructing one here eagerly would throw at import time, in the
 * process that boots better-auth.
 */

/** Opening the first session of an account's life, and setting its cookie. */
export function sessionMinter(): BetterAuthSessionMinter {
  return new BetterAuthSessionMinter();
}

/**
 * Spending the sign-up confirmation link (ADR-117 §6).
 *
 * The verification service is resolved per call rather than captured, for the
 * reason {@link signUpVerification} is composed per call: it reaches the
 * mailer, and the mailer is the one dependency a test routinely replaces.
 */
export function signUpConfirmationEndpoint(): SignUpConfirmationEndpoint {
  return new SignUpConfirmationEndpoint({
    verification: {
      completeVerification: ({ token }) =>
        signUpVerification().completeVerification({ token }),
    },
    users: {
      findUserIdByEmail: ({ email }) =>
        identityUsers.findUserIdByEmail({ normalizedValue: email }),
    },
    minter: sessionMinter(),
  });
}

/**
 * Signing somebody in with the password they just set (D13).
 *
 * A memoized singleton, because the instance owns the request scope the
 * endpoint's callback writes into and the after-hook reads back: two
 * instances would be two scopes, and the hook would find every reset
 * unattributed.
 */
let passwordResetSessionBridgeInstance: PasswordResetSessionBridge | null =
  null;

export function passwordResetSessionBridge(): PasswordResetSessionBridge {
  passwordResetSessionBridgeInstance ??= new PasswordResetSessionBridge({
    minter: sessionMinter(),
  });
  return passwordResetSessionBridgeInstance;
}

/** Creating an account WITH a passkey, rather than adding one to an account. */
export function passkeySignUp(): PasskeySignUpRegistration {
  return new PasskeySignUpRegistration({
    directory: identityUsers,
    accounts: {
      createPasskeyUser: ({ email, claimHash }) =>
        credentialAccounts().openPasskeyAccount({ email, claimHash }),
    },
    verification: {
      requestVerification: ({ email }) =>
        signUpVerification().requestVerification({ email }),
    },
  });
}

/** ADR-116 §3's born-finalized entrance, and the allowlist in front of it. */
export function bornFinalizedOptIn(): BornFinalizedOptIn {
  return new BornFinalizedOptIn({
    organizations: new PrismaLegacySsoOrganizationRepository(prisma),
    flag: {
      isEnabled: ({ distinctId, organizationId }) =>
        featureFlagService.isEnabled(BORN_FINALIZED_SIGNUP_FLAG, {
          distinctId,
          defaultValue: false,
          // Sign-up time: the person has no project yet, and an organization
          // only when their email domain matches one.
          projectId: NOT_TARGETED,
          organizationId: organizationId ?? NOT_TARGETED,
        }),
    },
  });
}

/** Whether a removal would leave somebody unable to sign in (ADR-119). */
export function lastWayIn(): LastWayInService {
  return new LastWayInService({
    records: new PrismaLastWayInRepository(prisma, routesToIdentityBranch),
  });
}

/** The same answer, as the refusal better-auth's `before` hook raises. */
export function lastWayInGuard(): LastWayInGuard {
  return new LastWayInGuard({ lastWayIn: lastWayIn() });
}

/**
 * bcrypt's cost for every password the credential service writes.
 *
 * It was a literal at each of the three sites that wrote one — registering,
 * setting a first password and changing one, all of them in the user router —
 * so raising it meant finding all three, and a site that was missed would go
 * on writing weaker hashes than the ones beside it with nothing to show for
 * it. better-auth's own legacy-hash bridge is the fourth door a password
 * arrives through, and it is HANDED this number (ADR-129) rather than
 * spelling one of its own, so the whole platform hashes at one cost.
 */
export const PASSWORD_HASH_ROUNDS = 10;

/**
 * An account's own credentials (ADR-129): opening one with a password or a
 * passkey, listing and unlinking the ways in, and setting, changing or simply
 * having a password.
 *
 * Composed per call like the write surfaces around it — the identifier attach
 * it states goes through a ledger that resolves the pipeline handle lazily, so
 * it must not be built at module load.
 *
 * bcrypt, Auth0's Management API and the analytics milestone arrive as
 * closures for the same reason every other environment-facing dependency here
 * does: the service states WHEN a password is hashed and WHO gets a sign-up
 * counted, and this root states what does the hashing and the counting.
 */
export function credentialAccounts(): CredentialAccountService {
  const legacyRecords = new PrismaCredentialAccountRepository(prisma);
  const identityWriter = IdentityAccountWriter.create({
    accounts: identityAccounts,
    ceremonies: identityCeremonies(),
  });

  return new CredentialAccountService({
    records: CredentialAccountStorageAdapter.create({
      legacy: legacyRecords,
      identityAccounts,
      identityWriter,
      routesToIdentity: routesToIdentityBranch,
      newAccountId: nanoid,
      now: () => new Date(),
    }),
    // The one case-insensitive address lookup, shared with the identity
    // guards rather than re-spelled for registration (ADR-129 rule 4).
    directory: identityUsers,
    passwords: {
      hash: ({ password }) => hash(password, PASSWORD_HASH_ROUNDS),
      matches: ({ password, hash: stored }) => compare(password, stored),
    },
    federated: {
      changePassword: ({
        email,
        federatedUserId,
        currentPassword,
        newPassword,
      }) =>
        changeAuth0Password({
          email,
          auth0UserId: federatedUserId,
          currentPassword,
          newPassword,
        }),
    },
    identifiers: signUpIdentifier(),
    sessions: sessionRevocation(),
    milestones: {
      signedUp: ({ userId }) =>
        trackServerEvent({ userId, event: "signed_up" }),
    },
  });
}

/**
 * The three compositions that used to live in satellite `*-runtime.ts` files
 * beside this one, and now do not (ADR-129).
 *
 * They were split off for one structural reason: two of them reach
 * `~/server/better-auth`, and `~/server/better-auth` builds its plugin list
 * and its storage adapter out of THIS file at module load. A static edge from
 * here to those adapters closed that loop, and a loop between two modules that
 * both work at load time crashes whichever side is entered second. The edge
 * now runs the other way: the boundary is HANDED the instance holder below and
 * fills it once `betterAuth()` has returned, so nothing in this tree names the
 * better-auth module as a value and the composition root can be one file.
 *
 * Everything here is composed PER CALL, like the write surfaces above: the
 * ledger writers resolve the pipeline handle lazily, so a service built before
 * the App exists still appends once one does.
 */

/**
 * The one better-auth instance, as the two adapters below reach it. Filled by
 * `server/better-auth/index.ts` the moment the instance exists; resolving it
 * earlier is a wiring fault and throws (`better-auth-instance.adapter.ts`).
 */
const betterAuthHandle = new BetterAuthInstanceHandle();

export function betterAuthInstance(): BetterAuthInstanceHandle {
  return betterAuthHandle;
}

/**
 * The proposal log, read. One instance: it holds no request state, and its
 * event-store handle is resolved per read anyway.
 */
const identityLinkProposalLog = new EventLogIdentityRepository();

/**
 * Deciding a waiting sign-in (ADR-117 §3). The ONLY way a proposal is
 * decided — nothing writes a decision anywhere else, because there is
 * nowhere else to write one: a decision is a fact on the person's history.
 */
export function linkProposals(): LinkProposalService {
  return new LinkProposalService({
    guards: new LinkProposalGuards({ proposals: identityLinkProposalLog }),
    // The shared factory, not a second construction: the store also releases
    // the address locks a user stops holding, and it needs the reservation
    // repository to do it.
    ledger: new IdentityLedgerWriter({
      projectionStore: identityProjectionStore(),
      heads: identityHeads,
    }),
    proposals: identityLinkProposalLog,
    directory: new BetterAuthLinkProposalDirectory({
      prisma,
      auth: betterAuthHandle,
    }),
  });
}

/** The platform operator's identity lookup (D05). */
export function identityLookup(): IdentityLookupService {
  return new IdentityLookupService({
    reads: new PrismaIdentityLookupRepository(prisma),
    history: identityLinkProposalLog,
    proposals: identityLinkProposalLog,
    router: signInRouter,
    identity: identityService,
    links: linkProposals,
    sessions: new BetterAuthOperatorSessions(sessionRevocation()),
    invitations: new InviteServiceOperatorInvitations(prisma),
  });
}

/**
 * The account side of two-step verification, composed (D06).
 *
 * It reaches the two-factor plugin's endpoints, which live on the better-auth
 * instance — the second of the two compositions the instance holder above
 * exists for.
 */
export function twoStepVerification(): TwoStepVerificationService {
  return new TwoStepVerificationService({
    account: new PrismaTwoStepAccount(prisma),
    protocol: new BetterAuthTwoStepProtocol(betterAuthHandle),
    offered: deploymentOffersTwoStepVerification,
  });
}

/**
 * What better-auth's secondary storage is composed from: whether this
 * deployment has one at all, and the connection a callback finds when it runs
 * (`better-auth/config/secondary-storage.ts` is the storage itself).
 *
 * WHETHER to configure it is a pure question about *configuration*, so it is
 * answered from env rather than from a live client (ADR-093), and it is
 * answered here rather than in the config module because the answer costs a
 * `RedisConfigService` — a construction that belongs to the composition root
 * like every other (ADR-129 rule 3).
 *
 * `BUILD_TIME` joins `SKIP_REDIS` in the skip signal: a build or a test run has
 * env pointing at a Redis it must not adopt as a session store.
 */
export function secondaryStorage(): SecondaryStorageDeps {
  return {
    configured: new RedisConfigService().isConfigured({
      url: env.REDIS_URL,
      clusterEndpoints: env.REDIS_CLUSTER_ENDPOINTS,
      skip: env.SKIP_REDIS || !!process.env.BUILD_TIME,
    }),
    connection: () => tryGetApp()?.redis ?? null,
  };
}

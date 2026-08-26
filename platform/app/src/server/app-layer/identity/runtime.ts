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
import { SsoLicenseRepository } from "@ee/sso/sso-license.repository";
import {
  SSO_DNS_REPROOF_GRACE_MS,
  type SsoConnectionState,
} from "@langwatch/identity";
import type { SignInDomainRoutingPort } from "@langwatch/identity-server";
import {
  engineProviderFor,
  IdentityBackfillService,
  IdentityEmailService,
  IdentityGuards,
  IdentitySecretCarryService,
  IdentityService,
  JoinRequestGuards,
  JoinRequestService,
  MfaGuards,
  MfaService,
  newIdentityCommandId,
  newSsoBreakGlassBindingId,
  SignInRouterService,
  SsoBreakGlassService,
  SsoConnectionGrandfatherService,
  SsoConnectionGuards,
  SsoConnectionService,
  SsoDomainReproofService,
  SsoSelfServeService,
  VerificationCeremonyService,
} from "@langwatch/identity-server";
import type { IdentityAccountCeremonies } from "@langwatch/identity-server/better-auth";
import {
  birthAwareGate,
  bridgeAccountCeremonies,
  createIdentityStorageAdapter,
  IdentityCeremonies,
  MfaCeremonies,
} from "@langwatch/identity-server/better-auth";
import type { BetterAuthOptions } from "better-auth";
import type { AdapterFactory } from "better-auth/adapters";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { env } from "~/env.mjs";
import { OrganizationUserRole } from "~/generated/prisma/client";
import { prisma } from "../../db";
import { featureFlagService } from "../../featureFlag";
import { sendAddressConfirmationEmail } from "../../mailer/addressConfirmationEmail";
import { sendSignUpVerificationEmail } from "../../mailer/signUpVerificationEmail";
import { createCredentialUser } from "../../users/credential-user";
import { getApp } from "../app";
import { grantsLedgerWriter } from "../authz/ledger";
import { PrismaSystemMigrationStateRepository } from "../system-migrations/repositories/system-migration-state.prisma.repository";
import { AccountIdentifiersService } from "./account-identifiers.service";
import { buildAddressConfirmationUrl } from "./address-confirmation-link";
import { IdentityBirthService } from "./birth";
import {
  LocalDoorBreakGlassBinding,
  RequiresLocalDoorAndBinding,
} from "./break-glass-binding";
import { InProcessBreakGlassLimiter } from "./break-glass-limiter";
import { IdentitySsoConnectionGrandfatherMigration } from "./connection-grandfather.migration";
import { IdentityIdentifierBackfillMigration } from "./identifier-backfill.migration";
import {
  EmailJoinRequestNotifier,
  PrismaJoinMembership,
  PrismaJoinOfferDismissals,
  PrismaJoinSettings,
} from "./join-request-adapters";
import { JoinRequestLedgerWriter } from "./join-request-ledger";
import { JoinRequestsService } from "./join-requests.service";
import { IdentityLedgerWriter } from "./ledger";
import { MemberProvenanceService } from "./member-provenance.service";
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
import { PrismaIdentityAccountsRepository } from "./repositories/identity-accounts.prisma.repository";
import { PrismaIdentityBackfillRepository } from "./repositories/identity-backfill.prisma.repository";
import { PrismaIdentityHeadsRepository } from "./repositories/identity-heads.prisma.repository";
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
import { LegacySsoDomainRoutingRepository } from "./repositories/legacy-sso-domain.prisma.repository";
import { PrismaLegacySsoOrganizationRepository } from "./repositories/legacy-sso-organization.prisma.repository";
import { PrismaMemberProvenanceRepository } from "./repositories/member-provenance.prisma.repository";
import { PrismaMfaEnrollmentRepository } from "./repositories/mfa-enrollment.prisma.repository";
import { PrismaMfaEnrollmentProjectionRepository } from "./repositories/mfa-enrollment-projection.prisma.repository";
import { PrismaSignUpHealthRepository } from "./repositories/sign-up-health.prisma.repository";
import {
  PrismaSignUpAccountDirectory,
  PrismaSignUpVerificationTokenStore,
} from "./repositories/signup-verification.prisma.repository";
import { PrismaSsoBreakGlassRepository } from "./repositories/sso-break-glass.prisma.repository";
import { PrismaSsoConnectionIssuers } from "./repositories/sso-connection-issuers.prisma.repository";
import { PrismaSsoConnectionProjectionRepository } from "./repositories/sso-connection-projection.prisma.repository";
import {
  PrismaSsoConnectionReadRepository,
  PrismaSsoConnectionStrandingRepository,
  PrismaSsoDomainClaimQueueRepository,
} from "./repositories/sso-connection-reads.prisma.repository";
import { SsoConnectionDomainRoutingRepository } from "./repositories/sso-connection-routing.prisma.repository";
import { PrismaSsoCredentialStore } from "./repositories/sso-credential.prisma.repository";
import { ConnectionFirstDomainRoutingRepository } from "./repositories/sso-routing-connection-first.repository";
import { IdentitySecretHealMigration } from "./secret-heal.migration";
import {
  IdTokenProviderAssertions,
  PrismaSessionIdentifiers,
  PrismaSessionRecords,
  RedisSessionCache,
} from "./session-adapters";
import { SessionClaimsService } from "./session-claims.service";
import { SessionInventoryService } from "./session-inventory.service";
import { SignUpHealthService } from "./sign-up-health.service";
import { ProjectionSignInAccountLookup } from "./signin-account-lookup";
import {
  deploymentOffersTwoStepVerification,
  resolveFederatedMethod,
  signInMethodPolicyPort,
} from "./signin-method-policy";
import { SignUpVerificationService } from "./signup-verification.service";
import { buildSignUpVerificationUrl } from "./signup-verification-link";
import { SsoConnectionLedgerWriter } from "./sso-connection-ledger";
import { HttpsDomainProofFileLookup } from "./sso-domain-file-lookup";
import { HttpSsoIssuerDiscovery } from "./sso-issuer-discovery";
import { ssoMethodIsConfiguredWith } from "./sso-method-configured";
import {
  DnsDomainProofLookup,
  EmailSsoDomainReproofNotifier,
  InstanceLicenseProof,
  LicenseDomainClaimAuthority,
  LoggingBreakGlassWarningNotifier,
  PrismaSsoDomainReproofTargets,
  PrismaSsoOrganizationMemberLookup,
  PrismaSsoTestSignInLookup,
  SsoSelfServeContextResolver,
} from "./sso-self-serve-adapters";
import {
  forgetIdentityWriteGate,
  isAnyoneOnIdentityWrites,
  isUserOnIdentityWrites,
} from "./write-gate";

/**
 * The connection-id predicate, re-stated for the same reason: it composes
 * nothing, but it lives in `@langwatch/identity-server`, and that package is
 * one of the two the boundary test says better-auth may reach only through
 * here.
 */
export { looksLikeSsoConnectionId } from "@langwatch/identity-server";
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
    new IdentityLedgerWriter({ projectionStore: identityProjectionStore() }),
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
  return new AccountIdentifiersService(
    identityHeads,
    identityService(),
    verificationCeremony(),
    {
      sendConfirmation: sendAddressConfirmationEmail,
      buildConfirmationUrl: buildAddressConfirmationUrl,
      newCommandId: newIdentityCommandId,
      now: () => Date.now(),
    },
  );
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
 * Whether a connection can actually be dialed (D09) — the seam where the two
 * engines coexist, composed from its two ports. The decision itself is
 * `sso-method-configured.ts`; what lives here is where each answer comes
 * from.
 */
const ssoMethodIsConfigured = ssoMethodIsConfiguredWith({
  mountedMethodId: async () => (await resolveFederatedMethod())?.id ?? null,
  engineHoldsProvider: async ({ connectionId }) =>
    (await prisma.ssoProvider.findFirst({
      where: { providerId: connectionId },
      select: { id: true },
    })) !== null,
});

/**
 * The projection-backed domain lookup (D04, D09). `configured` means what it
 * has always meant — whether a sign-in sent here would ARRIVE anywhere — and
 * since D09 there are two ways for that to be true: the provider this
 * deployment mounts from its environment, and a provider this organization
 * registered for itself. `ssoMethodIsConfigured` is the seam where both
 * answer, and it is what makes the two engines coexist rather than take
 * turns.
 */
const ssoConnectionDomainRouting = new SsoConnectionDomainRoutingRepository(
  prisma,
  ssoMethodIsConfigured,
);

/**
 * Which lookup the router gets (ADR-117 §5, revised by D09).
 *
 * TURNING THE CONNECTION ON IS THE DECISION. An administrator who proves a
 * domain, tests a sign-in, holds a way back in and presses go-live has said
 * what they want as plainly as it can be said. D04 staged this on an
 * environment variable and D09 on a per-organization feature flag; both were
 * a second lever the person who made the decision could not reach, and a
 * connection reading "on" while it carried nobody is a screen disagreeing
 * with itself.
 *
 * So a connection that is live decides the domains it proved, and every
 * organization without one is answered by the legacy `Organization.ssoDomain`
 * / `ssoProvider` columns exactly as before. Rolling a customer back is
 * turning their connection off, which is the control they already have.
 */
export function signInDomainRoutingPort(): SignInDomainRoutingPort {
  return new ConnectionFirstDomainRoutingRepository({
    legacy: legacySsoDomainRouting,
    connections: ssoConnectionDomainRouting,
  });
}

/**
 * The identifier-first sign-in router (D03, ADR-117), composed here from its
 * ports: the connection-first domain lookup, the instance method
 * policy that owns ADR-027's frozen license gate, and — since the revision of
 * 2026-08-25 — what the submitted address's account holds.
 *
 * A singleton rather than a per-call composition: it holds no request state,
 * and the break-glass budget above must not be reset by composing it again.
 * The flag is read once, here, for the same reason ADR-027's license gate is
 * a per-process memo — a auth screens that changes which store it reads
 * mid-flight is not something anyone can reason about during an incident.
 */
const signInRouterService = new SignInRouterService({
  domains: signInDomainRoutingPort(),
  policy: signInMethodPolicyPort,
  breakGlass: breakGlassLimiter,
  accounts: new ProjectionSignInAccountLookup(identityHeads),
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
      breakGlass: activationBreakGlassPort(),
      stranding: new PrismaSsoConnectionStrandingRepository(prisma),
      platformOperators: new AdminEmailPlatformOperators(prisma),
      licenseAuthority: new LicenseDomainClaimAuthority(),
    }),
    new SsoConnectionLedgerWriter({
      projectionStore: new PrismaSsoConnectionProjectionRepository(
        prisma,
        ssoEngineProviderDerivation,
      ),
    }),
  );
}

/**
 * The credential vault the connection's references point at (D09 — see
 * specs/identity/sso-idp-termination.feature). A module singleton because it
 * holds nothing but the Prisma handle and both the command path and the fold
 * need the same one.
 */
const ssoCredentials = new PrismaSsoCredentialStore(prisma);

/**
 * How the engine's provider row is derived from a connection's folded state.
 *
 * Exported as one function, given to BOTH projection-store construction sites
 * (the ledger writer's and the pipeline registry's), because the two are the
 * same projection reached two ways and a derivation that differed between
 * them would be two answers to "what is registered".
 */
export const ssoEngineProviderDerivation = ({
  connection,
}: {
  connection: SsoConnectionState;
}) =>
  engineProviderFor({
    connection,
    credentials: ssoCredentials,
    baseUrl: env.NEXTAUTH_URL ?? "",
  });

/**
 * The ways back in (D05). Composed per call, holds no state.
 *
 * This service IS the port activation has been asking since D04, which is
 * what "the requirement ships before the mechanism" was for: no guard,
 * command or test changed to start enforcing real bindings.
 */
export function ssoBreakGlass(): SsoBreakGlassService {
  return new SsoBreakGlassService({
    bindings: new PrismaSsoBreakGlassRepository(prisma),
    notifier: new LoggingBreakGlassWarningNotifier(),
    newBindingId: newSsoBreakGlassBindingId,
    // The revoke guard's one outside fact: whether an ACTIVE connection is
    // deciding this organization's sign-in right now.
    organizationHasActiveConnection: async ({ organizationId }) =>
      (await prisma.ssoConnection.count({
        where: { organizationId, state: "ACTIVE" },
      })) > 0,
    // The same people `breakGlassCandidates` lists, asked on the write path.
    // A grant naming anybody else satisfies activation's precondition and
    // opens no door.
    holderIsEligible: async ({ organizationId, userId }) =>
      (await prisma.organizationUser.count({
        where: {
          organizationId,
          userId,
          disabledAt: null,
          role: OrganizationUserRole.ADMIN,
        },
      })) > 0,
  });
}

/**
 * Activation's break-glass precondition, as of D05: a live binding AND a
 * local door for it to be a way in through.
 *
 * Both, because they answer different halves of the same question. A binding
 * on an installation that mounts no local method names somebody who cannot
 * actually sign in; a local door with nobody named is the pre-D05 answer,
 * which activation was always going to outgrow. Requiring both is the only
 * reading under which "somebody can still get in" is true.
 */
function activationBreakGlassPort(): RequiresLocalDoorAndBinding {
  return new RequiresLocalDoorAndBinding({
    localDoor: new LocalDoorBreakGlassBinding(),
    bindings: ssoBreakGlass(),
  });
}

/**
 * The operator queue's read (D05), which is disputes only: a published
 * record decides every uncontested claim, so what is left for a person is a
 * domain two organizations both claim.
 */
export function ssoDomainClaimQueue(): PrismaSsoDomainClaimQueueRepository {
  return new PrismaSsoDomainClaimQueueRepository(prisma);
}

/**
 * Self-serve single sign-on setup, tiers 2 and 3 (D05). Composed per call
 * like the write surfaces it drives, and every verb on it is one of theirs.
 */
export function ssoSelfServe(): SsoSelfServeService {
  const licenseProof = new InstanceLicenseProof(
    new SsoLicenseRepository(prisma),
  );
  return new SsoSelfServeService({
    connections: ssoConnections,
    reads: new PrismaSsoConnectionReadRepository(prisma),
    context: new SsoSelfServeContextResolver({
      featureFlags: featureFlagService,
      licenseProof,
    }),
    proofs: new DnsDomainProofLookup(),
    files: new HttpsDomainProofFileLookup(),
    license: licenseProof,
    credentials: ssoCredentials,
    discovery: new HttpSsoIssuerDiscovery(),
    baseUrl: env.NEXTAUTH_URL ?? "",
    // The evidence a test sign-in happened is the account the engine wrote,
    // read here rather than recorded anywhere: activation carries the id of
    // an account that exists, or it is refused.
    testSignIns: new PrismaSsoTestSignInLookup(prisma),
    // The READ half of break glass only. Granting and renewing stay on
    // `ssoBreakGlass()`, which the setup service never holds — this surface
    // lists the ways back in and never writes one.
    breakGlass: ssoBreakGlass(),
    members: new PrismaSsoOrganizationMemberLookup(prisma),
  });
}

/**
 * The sweep that re-reads the records proving domains (ADR-123). Composed per
 * call like every write surface here, and the grace window is stated once,
 * HERE, rather than read inside the package: how long a customer keeps
 * vouching after their record goes missing is a product decision this
 * composition root owns.
 */
export function ssoDomainReproof(): SsoDomainReproofService {
  return new SsoDomainReproofService({
    connections: ssoConnections,
    targets: new PrismaSsoDomainReproofTargets(prisma),
    proofs: new DnsDomainProofLookup(),
    files: new HttpsDomainProofFileLookup(),
    notifier: new EmailSsoDomainReproofNotifier(prisma),
    graceMs: SSO_DNS_REPROOF_GRACE_MS,
  });
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
    dismissals: new PrismaJoinOfferDismissals(prisma),
    // The licence asymmetry, stated once: the gate that has always held
    // single sign-on holds AUTOMATIC joining, because that is federation —
    // the deployment decides who counts as a colleague and admits them with
    // nobody in the loop. Asking to join is not gated and never reads this,
    // which is what keeps "my company is invisible" fixed on precisely the
    // self-hosted deployments that have no other way out.
    autoJoinLicensed: () => platformSSOAllowed(),
    // The organization's own plan, resolved the one way the app resolves
    // plans — the provider that answers for a subscription row on Cloud and
    // for a signed license self-hosted. Read per call rather than captured,
    // so an organization that upgrades this morning can open its door this
    // morning. Closing it never reaches here.
    joinPolicyEntitled: async ({ organizationId }) =>
      (await getApp().planProvider.getActivePlan({ organizationId })).type ===
      PlanTypes.ENTERPRISE,
  });
}

/**
 * Why each member of an organization is here, for the members list.
 *
 * Reads only facts written for other reasons — the directory's identifier
 * mapping, the join-request projection and the invitation table — so a
 * member's provenance is answerable for people who joined long before the
 * chip that shows it existed.
 */
export function memberProvenance(): MemberProvenanceService {
  return new MemberProvenanceService({
    reads: new PrismaMemberProvenanceRepository(prisma),
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
export function sessionClaims(): SessionClaimsService {
  return new SessionClaimsService({
    identifiers: new PrismaSessionIdentifiers(prisma),
    assertions: new IdTokenProviderAssertions(prisma),
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
      createCredentialAccount: async ({ email, passwordHash }) => {
        // Nobody has been asked for a name on this path: the person typed an
        // address and a password into a log-in form. Onboarding asks.
        await createCredentialUser({
          prisma,
          name: null,
          email,
          passwordHash,
        });
      },
      markAddressConfirmed: async ({ email }) => {
        // Case-insensitive for the same reason the lookup beside it is: rows
        // written before sign-up lowercased addresses may carry capitals, and
        // an exact match would quietly confirm nothing.
        await prisma.user.updateMany({
          where: { email: { equals: email, mode: "insensitive" } },
          data: { emailVerified: true },
        });
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
  accounts: identityAccounts,
  resolution: identityResolution,
  connectionIssuers: new PrismaSsoConnectionIssuers(prisma),
  ceremonies: identityCeremonies(),
  isUserOnIdentityWrites: isLatched,
  isAnyoneOnIdentityWrites: isAnyoneLatched,
  birth: identityBirth(),
});

export function identityStorageAdapter(): AdapterFactory<BetterAuthOptions> {
  return identityStorage;
}

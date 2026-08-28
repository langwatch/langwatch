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

import { platformSSOAllowed } from "~/runtime/app/features/sso";
import type { AuthzGrantsService } from "@langwatch/authz-contract";
import type { FeatureFlagService } from "@langwatch/feature-flag-contract";
import type { SignInDomainRoutingPort } from "@langwatch/identity-server";
import type { UserService } from "@langwatch/user-contract";
import { trackServerEvent } from "~/server/posthog";
import {
  IdentityBackfillService,
  IdentityEmailService,
  IdentityGuards,
  IdentitySecretCarryService,
  IdentityService,
  JoinRequestGuards,
  JoinRequestService,
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
  IdentityCeremonies,
} from "@langwatch/identity-server/better-auth";
import type { BetterAuthOptions } from "better-auth";
import type { AdapterFactory } from "better-auth/adapters";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { env } from "~/env.mjs";
import { prisma } from "../../db";
import { sendSignUpVerificationEmail } from "../../mailer/signUpVerificationEmail";
import type { EmailDeliveryPort } from "../../mailer/providers/types";
import { PrismaSystemMigrationStateRepository } from "../system-migrations/repositories/system-migration-state.prisma.repository";
import { IdentityBirthService } from "./birth";
import { LocalDoorBreakGlassBinding } from "./break-glass-binding";
import { InProcessBreakGlassLimiter } from "./break-glass-limiter";
import { IdentitySsoConnectionGrandfatherMigration } from "./connection-grandfather.migration";
import { IdentityIdentifierBackfillMigration } from "./identifier-backfill.migration";
import {
  EmailJoinRequestNotifier,
  PrismaJoinMembership,
  PrismaJoinSettings,
} from "./join-request-adapters";
import { JoinRequestLedgerWriter } from "./join-request-ledger";
import { JoinRequestsService } from "./join-requests.service";
import { IdentityLedgerWriter } from "./ledger";
import { IdentityNewbornReconciliationService } from "./newborn-reconciliation";
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
import { resolveFederatedMethod, signInMethodPolicyPort } from "./signin-method-policy";
import { SignUpVerificationService } from "./signup-verification.service";
import { buildSignUpVerificationUrl } from "./signup-verification-link";
import { SsoConnectionLedgerWriter } from "./sso-connection-ledger";
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
export { deploymentIsFederationCapable, resolveSignInMethodPolicy } from "./signin-method-policy";

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

const legacySsoDomainRouting = new LegacySsoDomainRoutingRepository(prisma, resolveFederatedMethod);

/**
 * The projection-backed domain lookup (D04). `configured` still means what it
 * meant before the aggregate existed: whether this deployment actually
 * mounted the method the connection names. Pre-D05 an instance mounts one
 * IdP, so agreement with `resolveFederatedMethod()` is the whole test — and
 * keeping it identical to the legacy repository's rule is what lets shadow
 * mode's disagreements mean "the DATA differs", not "the two ports judge
 * configuration differently".
 */
const ssoConnectionDomainRouting = new SsoConnectionDomainRoutingRepository(
  prisma,
  async (methodId) => (await resolveFederatedMethod())?.id === methodId,
);

/**
 * Which lookup the router gets (ADR-117 §5). The ENTIRE flip is this
 * function: the router, the engine and `signInRouterShadow.ts` never learn
 * which side they are on.
 *
 *   off      the strings, and nothing else reads or runs.
 *   shadow   the strings decide; the projection lookup runs alongside and
 *            disagreements are logged with both answers.
 *   enforce  the projection decides.
 *
 * String WRITES stop only at `enforce`, and this slice stops none of them —
 * which is what makes the rollback "flag off" rather than a restore.
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
 * two ports: the domain lookup `SSOCONN_ROUTING` selects, and the instance
 * method policy that owns ADR-027's frozen license gate.
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
      platformOperators: new AdminEmailPlatformOperators(prisma),
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
export function joinRequestsService({
  authzGrants,
  featureFlags,
  mailer,
}: {
  authzGrants: AuthzGrantsService;
  featureFlags: FeatureFlagService;
  mailer: EmailDeliveryPort;
}): JoinRequestsService {
  return new JoinRequestsService({
    requests: joinRequests(),
    reads: new PrismaJoinRequestReadRepository(prisma),
    candidates: new PrismaJoinCandidateRepository(prisma),
    membership: new PrismaJoinMembership(prisma, authzGrants),
    notifier: new EmailJoinRequestNotifier(prisma, mailer),
    settings: new PrismaJoinSettings(prisma),
    // The licence asymmetry, stated once: the gate that has always held
    // single sign-on holds AUTOMATIC joining, because that is federation —
    // the deployment decides who counts as a colleague and admits them with
    // nobody in the loop. Asking to join is not gated and never reads this,
    // which is what keeps "my company is invisible" fixed on precisely the
    // self-hosted deployments that have no other way out.
    autoJoinLicensed: () => platformSSOAllowed(),
    enabled: ({ userId }) =>
      featureFlags.isEnabled("join_requests", {
        // A person asks to join before they belong to anything, so the read
        // names the person and no tenant at all. A rule that names a project
        // or an organization cannot match this target, which is the point.
        kind: "user",
        userId,
      }),
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
export function signUpVerification(
  mailer: EmailDeliveryPort,
  users: UserService,
): SignUpVerificationService {
  return new SignUpVerificationService({
    tokens: new PrismaSignUpVerificationTokenStore(prisma),
    directory: new PrismaSignUpAccountDirectory(prisma),
    mailer: {
      sendVerificationLink: ({ email, verificationUrl }) =>
        sendSignUpVerificationEmail({ mailer, email, verificationUrl }),
    },
    accounts: {
      createCredentialAccount: async ({ email, passwordHash }) => {
        // Nobody has been asked for a name on this path: the person typed an
        // address and a password into a log-in form. Onboarding asks.
        const created = await users.createCredentialUser({
          name: null,
          email,
          passwordHash,
        });
        trackServerEvent({ userId: created.id, event: "signed_up" });
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
  ceremonies: identityCeremonies(),
  isUserOnIdentityWrites: isLatched,
  isAnyoneOnIdentityWrites: isAnyoneLatched,
  birth: identityBirth(),
});

export function identityStorageAdapter(): AdapterFactory<BetterAuthOptions> {
  return identityStorage;
}

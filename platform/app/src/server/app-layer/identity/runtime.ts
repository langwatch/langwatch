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
import type { SignInDomainRoutingPort } from "@langwatch/identity-server";
import {
  IdentityBackfillService,
  IdentityEmailService,
  IdentityGuards,
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
import { IdentityCeremonies } from "@langwatch/identity-server/better-auth";
import { platformSSOAllowed } from "@ee/sso/sso-gate";
import { hash } from "bcrypt";
import { env } from "~/env.mjs";
import { prisma } from "../../db";
import { featureFlagService } from "../../featureFlag";
import { grantsLedgerWriter } from "../authz/ledger";
import { sendSignUpVerificationEmail } from "../../mailer/signUpVerificationEmail";
import { createCredentialUser } from "../../users/credential-user";
import { PrismaSystemMigrationStateRepository } from "../system-migrations/repositories/system-migration-state.prisma.repository";
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
import { PrismaIdentityBackfillRepository } from "./repositories/identity-backfill.prisma.repository";
import { PrismaIdentityHeadsRepository } from "./repositories/identity-heads.prisma.repository";
import { PrismaIdentityProjectionRepository } from "./repositories/identity-projection.prisma.repository";
import { PrismaIdentityUsersRepository } from "./repositories/identity-users.prisma.repository";
import { PrismaIdentityVerificationRepository } from "./repositories/identity-verification.prisma.repository";
import { PrismaJoinRequestProjectionRepository } from "./repositories/join-request-projection.prisma.repository";
import {
  PrismaJoinCandidateRepository,
  PrismaJoinRequestReadRepository,
} from "./repositories/join-request.prisma.repository";
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
import {
  resolveFederatedMethod,
  signInMethodPolicyPort,
} from "./signin-method-policy";
import { SignUpVerificationService } from "./signup-verification.service";
import { buildSignUpVerificationUrl } from "./signup-verification-link";
import { SsoConnectionLedgerWriter } from "./sso-connection-ledger";
import { isUserOnIdentityWrites } from "./write-gate";

const identityHeads = new PrismaIdentityHeadsRepository(prisma);
const identityUsers = new PrismaIdentityUsersRepository(prisma);
const migrationState = new PrismaSystemMigrationStateRepository(prisma);

/** The per-user fork as the services take it: one closure, one state
 *  repository, composed here rather than defaulted inside a service. The
 *  SAME predicate forks the ceremonies' writes and the email read — ADR-110's
 *  one switch, re-tenanted to users. */
export function isLatched({ userId }: { userId: string }): Promise<boolean> {
  return isUserOnIdentityWrites({ userId, state: migrationState });
}

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
    new IdentityGuards(identityHeads),
    new IdentityLedgerWriter({
      projectionStore: new PrismaIdentityProjectionRepository(prisma),
    }),
  );
}

export function verificationCeremony(): VerificationCeremonyService {
  return new VerificationCeremonyService(
    new PrismaIdentityVerificationRepository(prisma),
    identityHeads,
    identityService(),
    { isLatched },
  );
}

export function identityBackfill(): IdentityBackfillService {
  return new IdentityBackfillService(
    new PrismaIdentityBackfillRepository(prisma),
    identityUsers,
    identityService(),
  );
}

/** The D01 backfill as the migrations runtime registers it (tenant = user). */
export function identifierBackfillMigration(): IdentityIdentifierBackfillMigration {
  return new IdentityIdentifierBackfillMigration(identityBackfill());
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
      featureFlagService.isEnabled("join_requests", { distinctId: userId }),
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
    },
    // The same cost factor every other credential in the platform is hashed
    // at, in the one place this path hashes anything.
    hashPassword: (password) => hash(password, 10),
    buildVerificationUrl: ({ token }) => buildSignUpVerificationUrl(token),
  });
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
    isLatched,
    { now: Date.now, newCommandId: newIdentityCommandId },
  );
}

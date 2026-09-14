/**
 * Builds the {@link UserInfrastructure} this module used to receive
 * hand-composed (`apps/api/src/features/user/user.composition.ts`, deleted by
 * b383462d96). `UserApp.create` now builds it itself from the two members it
 * reads — `prisma` and `redis` — its own config, and its contract peers.
 *
 * Every branch here is the deleted composition's own, kept verbatim where a
 * member or a peer can stand in for what it read: `deployment.authProvider`
 * is `dependencies.auth.resolveAuthProvider()` (the SAME auth application the
 * deleted composition read through a peer function of the identical name);
 * the organization directory's Prisma reads are the deleted composition's
 * own queries, over the `prisma` member instead of an externally-supplied
 * client; the per-budget rate limiter is the fixed-window counter
 * `automation-composition.build.ts` already built for the same reason (each
 * caller names its own window and ceiling, which the process's shared
 * `rateLimiter` member cannot, since that one is built with ONE fixed policy
 * at boot).
 *
 * What the deleted composition refused by name — the Auth0 tenant, CLI
 * credential revocation, gateway governance, the Enterprise spend ledger —
 * still refuses by name here. What it wired to the stored-object family (the
 * avatar bytes) and to the identity ceremony (email verification) refuses by
 * name too: neither crossing is a member or a declared dependency of this
 * module yet, and no package owns the adapter that would make it one.
 */
import type { AuthApi } from "@langwatch/auth-contract";
import { HandledError } from "@langwatch/handled-error";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectApi } from "@langwatch/project-contract";
import type { RedisConnection } from "@langwatch/redis-client";
import { hash, compare } from "bcrypt";

import type { UserAppConfig, UserInfrastructure } from "./user.app.ts";

/** What this process hands `UserApp` at boot. */
export function buildUserInfrastructure(input: {
  prisma: PrismaClient;
  redis: RedisConnection;
  config: UserAppConfig;
  dependencies: {
    auth: AuthApi;
    organizations: OrganizationApi;
    projects: ProjectApi;
  };
}): UserInfrastructure {
  const { prisma, redis, config, dependencies } = input;

  return {
    // The issuer a credential account row is stored under is a persisted
    // format: `local:credential`, exactly what
    // `BetterAuthAccountQueriesAdapter.issuerForProviderId("credential")`
    // (`@langwatch/identity-server`) evaluates to for this one provider id.
    // Restated as the literal here rather than imported, since a module may
    // not value-import another module's server package (ADR-134) and the
    // format is fixed for this input.
    credentialIssuer: "local:credential",
    avatarStorage: {
      store: () =>
        Promise.reject(
          unavailable(
            "stored-object application, so it cannot store an uploaded avatar",
          ),
        ),
    },
    avatarObjects: {
      findById: () =>
        Promise.reject(
          unavailable("stored-object application, so it cannot read an avatar object"),
        ),
    },
    // The stored-password format, stated ONCE for this process. Both halves
    // of a rotation run through it, and the credential service (the only
    // holder of a stored hash) is built over it by the installer.
    passwords: new BcryptPasswordHasher(),
    deployment: {
      authProvider: () => dependencies.auth.resolveAuthProvider(),
      offersPasskeys: () => config.passkeysEnabled,
      findBaseUrl: () => config.baseUrl,
    },
    rateLimit: new RedisUserRateLimiter(redis).check,
    // The product-analytics sink is the deployment's. Absent, and silent on
    // purpose: an analytics write has never been allowed to fail a request.
    analytics: { trackServerEvent: () => undefined },
    federatedPasswords: {
      // The Auth0 tenant is the deployment's own, and reading or changing an
      // identity in it is an API call against credentials this process does
      // not hold. Both halves refuse together: a lookup that answered would
      // only reach a change that cannot.
      findDatabaseAccount: () =>
        Promise.reject(
          unavailable("Auth0 tenant credentials, so it cannot read an Auth0 identity"),
        ),
      changePassword: () =>
        Promise.reject(
          unavailable("Auth0 tenant credentials, so it cannot change an Auth0 password"),
        ),
    },
    // CLI tokens are an Enterprise governance capability. It refuses rather
    // than returning: a deactivation that silently left the person's CLI
    // credentials live would be the failure this call exists to prevent.
    cliCredentials: {
      revokeForUser: () =>
        Promise.reject(
          unavailable(
            "Enterprise governance service, so it cannot revoke this user's CLI tokens",
          ),
        ),
    },
    organizations: organizationDirectory({ prisma, organizations: dependencies.organizations }),
    projects: {
      findById: ({ projectId }) => dependencies.projects.findIdentity(projectId),
      // The organization's hidden governance project is minted by Enterprise
      // governance, which this process does not compose. Absent is the
      // honest answer and the one the module already handles.
      findGovernanceProject: () => Promise.resolve(null),
    },
    // The gateway's own stores. All three are Enterprise, and all three
    // refuse rather than answering: a budget pre-check that answered
    // "allowed" without a store would let spend through unmetered.
    gateway: {
      findDefaultRoutingPolicy: () =>
        Promise.reject(
          unavailable("Enterprise gateway governance, so it holds no default routing policy"),
        ),
      listPersonalVirtualKeys: () =>
        Promise.reject(
          unavailable("Enterprise gateway governance, so it holds no personal gateway keys"),
        ),
      checkBudget: () =>
        Promise.reject(
          unavailable("Enterprise gateway budget store, so it cannot check a budget"),
        ),
    },
    budgetRequests: {
      sendBudgetIncreaseRequest: () =>
        Promise.reject(
          unavailable(
            "mail gateway with a public base URL, so it cannot send the budget increase request",
          ),
        ),
    },
    // The identifier ledger's email-verification ceremony. No package owns
    // an adapter from this module's declared reads to the identity
    // application's ceremony yet.
    verification: {
      completeEmailVerification: () =>
        Promise.reject(
          unavailable("identity verification ceremony, so it cannot complete a verification"),
        ),
    },
    // The spend rollup behind `/api/me/usage`. Enterprise governance owns
    // the ledger, so a deployment without it refuses by name rather than
    // reporting a zero somebody would read as "you spent nothing".
    personalUsage: {
      personalUsage: () =>
        Promise.reject(
          unavailable("spend ledger, so it cannot roll up this person's own AI usage"),
        ),
    },
  };
}

/**
 * One person's own verified organization membership and the two ledger reads
 * `/me` renders: the support contact and the first project a caller may land
 * on. The Prisma reads are the deleted composition's own; the membership
 * check and the settings read go through the SAME organization application
 * every other member call is answered from.
 */
function organizationDirectory(options: {
  prisma: PrismaClient;
  organizations: OrganizationApi;
}): UserInfrastructure["organizations"] {
  const { prisma, organizations } = options;

  return {
    isMember: ({ userId, organizationId }) => organizations.isMember({ userId, organizationId }),
    findSupportContact: async ({ organizationId }) => {
      const settings = await organizations.getSettings({ organizationId });
      if (settings.supportContact) return settings.supportContact;

      return await firstAdminEmail(prisma, organizationId);
    },
    getBudgetIncreaseRecipient: async ({ organizationId }) => {
      const adminEmail = await firstAdminEmail(prisma, organizationId);
      if (!adminEmail) {
        throw unavailable(
          "administrator for this organization to send the budget increase request to",
        );
      }

      return adminEmail;
    },
    findName: async ({ organizationId }) =>
      (
        await prisma.organization.findUnique({
          where: { id: organizationId },
          select: { name: true },
        })
      )?.name ?? null,
    findFirstProjectSlug: async ({ organizationId, userId }) =>
      (
        await prisma.project.findFirst({
          where: { team: { organizationId, members: { some: { userId } } }, archivedAt: null },
          orderBy: { createdAt: "asc" },
          select: { slug: true },
        })
      )?.slug ?? null,
  };
}

/**
 * The organization's first administrator, by seat age. A row read with the
 * organization id already in hand, which is why it lives here beside the
 * other reads this module answers from its own `prisma` member rather than
 * behind a port.
 */
async function firstAdminEmail(prisma: PrismaClient, organizationId: string): Promise<string | null> {
  const admin = await prisma.organizationUser.findFirst({
    where: { organizationId, role: "ADMIN", disabledAt: null },
    orderBy: { createdAt: "asc" },
    select: { user: { select: { email: true } } },
  });

  return admin?.user.email ?? null;
}

const REDIS_RATE_LIMIT_PREFIX = "user:rate-limit:";

/**
 * Per-key fixed-window counting for this module's own multi-budget throttles
 * (sign-up, first-password, avatar upload — each with its own window and
 * ceiling), which the process's shared `rateLimiter` member cannot serve:
 * that one is built with ONE fixed policy at boot. The same shape
 * `automation-composition.build.ts` already built for the identical reason.
 */
class RedisUserRateLimiter {
  constructor(private readonly redis: RedisConnection) {}

  check = async (
    input: Readonly<{ key: string; windowSeconds: number; max: number }>,
  ): Promise<Readonly<{ allowed: boolean; resetAt: number }>> => {
    const redisKey = `${REDIS_RATE_LIMIT_PREFIX}${input.key}`;
    const count = await this.redis.incr(redisKey);
    if (count === 1) {
      await this.redis.expire(redisKey, input.windowSeconds);
    }
    const ttl = await this.redis.ttl(redisKey);

    return {
      allowed: count <= input.max,
      resetAt: Date.now() + (ttl > 0 ? ttl : input.windowSeconds) * 1000,
    };
  };
}

/** The bcrypt cost every stored credential in this database was written at. */
const PASSWORD_HASH_COST = 10;

/**
 * The stored password format, stated ONCE for this process. bcrypt at cost
 * 10, which is what every credential row in the database already carries.
 */
class BcryptPasswordHasher {
  hash({ password }: { password: string }): Promise<string> {
    return hash(password, PASSWORD_HASH_COST);
  }

  matches({ password, hash: stored }: { password: string; hash: string }): Promise<boolean> {
    return compare(password, stored);
  }
}

/**
 * A capability this deployment does not hold. `fault: "platform"` because
 * nothing the customer sent caused it, and the message names which
 * capability is missing.
 */
class UserCapabilityUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(capability: string) {
    super("service_unavailable", `This deployment has no ${capability}.`, {
      httpStatus: 503,
      fault: "platform",
      meta: { capability },
    });
    this.name = "UserCapabilityUnavailableError";
  }
}

function unavailable(capability: string): UserCapabilityUnavailableError {
  return new UserCapabilityUnavailableError(capability);
}

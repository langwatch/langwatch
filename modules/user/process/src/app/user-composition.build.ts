/**
 * What this process still hands `UserApp` by hand. Every entry that refuses
 * names what it would need; `user.members.ts` names the module each
 * unanswered capability belongs to.
 */

import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProcessMembers } from "@langwatch/process-stores/members";
import type { RedisConnection } from "@langwatch/redis-client";
import { nowInstant } from "@langwatch/time";
import { UserCapabilityUnavailableError } from "@langwatch/user-contract";
import { hash, compare } from "bcrypt";

import { PrismaUserOrganizationDirectoryRepository } from "../repositories/prisma/prisma.user-organization-directory.repository.ts";
import type { UserInfrastructure } from "./user.members.ts";

/** What this process hands `UserApp` at boot. */
export function buildUserInfrastructure(input: {
  prisma: ProcessMembers["prisma"];
  redis: RedisConnection;
  organizations: OrganizationApi;
}): UserInfrastructure {
  const { prisma, redis, organizations } = input;

  return {
    avatarStorage: {
      store: () =>
        Promise.reject(
          unavailable("stored-object application, so it cannot store an uploaded avatar"),
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
          unavailable("Enterprise governance service, so it cannot revoke this user's CLI tokens"),
        ),
    },
    organizations: organizationDirectory({
      directory: PrismaUserOrganizationDirectoryRepository.create(prisma),
      organizations,
    }),
    governanceProjects: {
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
        Promise.reject(unavailable("Enterprise gateway budget store, so it cannot check a budget")),
    },
    budgetRequests: {
      sendBudgetIncreaseRequest: () =>
        Promise.reject(
          unavailable(
            "mail gateway with a public base URL, so it cannot send the budget increase request",
          ),
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
 * The two ledger reads `/me` renders (support contact, first project) and the
 * administrator a budget request goes to. The settings read goes through the
 * SAME organization application every other member call uses.
 */
function organizationDirectory(options: {
  directory: PrismaUserOrganizationDirectoryRepository;
  organizations: OrganizationApi;
}): UserInfrastructure["organizations"] {
  const { directory, organizations } = options;

  return {
    findSupportContact: async ({ organizationId }) => {
      const settings = await organizations.getSettings({ organizationId });
      if (settings.supportContact) return settings.supportContact;

      return directory.findFirstAdminEmail(organizationId);
    },
    getBudgetIncreaseRecipient: async ({ organizationId }) => {
      const adminEmail = await directory.findFirstAdminEmail(organizationId);
      if (!adminEmail) {
        throw unavailable(
          "administrator for this organization to send the budget increase request to",
        );
      }

      return adminEmail;
    },
    findName: ({ organizationId }) => directory.findName(organizationId),
    findFirstProjectSlug: ({ organizationId, userId }) =>
      directory.findFirstProjectSlug({ organizationId, userId }),
  };
}

const REDIS_RATE_LIMIT_PREFIX = "user:rate-limit:";

/**
 * Per-key fixed-window counting for this module's multi-budget throttles
 * (sign-up, first-password, avatar upload), since the shared `rateLimiter`
 * is built with ONE fixed policy — same shape `automation-composition.build.ts` uses.
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
      resetAt: nowInstant().epochMilliseconds + (ttl > 0 ? ttl : input.windowSeconds) * 1000,
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

function unavailable(capability: string): UserCapabilityUnavailableError {
  return new UserCapabilityUnavailableError(capability);
}

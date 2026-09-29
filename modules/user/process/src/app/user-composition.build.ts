/**
 * What this process still hands `UserApp` by hand. Every entry that refuses
 * names what it would need; `user.members.ts` names the module each
 * unanswered capability belongs to.
 */

import type { AuthApi } from "@langwatch/auth-contract";
import type { EnterpriseGatewayApi } from "@langwatch/enterprise-gateway-contract";
import type { GovernanceRestApi } from "@langwatch/enterprise-governance-contract";
import type { GatewayApi } from "@langwatch/gateway-contract";
import { HandledError } from "@langwatch/handled-error";
import { sendBudgetIncreaseRequestEmail, type MailSender } from "@langwatch/mail";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProcessMembers } from "@langwatch/process-stores/members";
import { PROJECT_KIND, type ProjectApi } from "@langwatch/project-contract";
import type { RedisConnection } from "@langwatch/redis-client";
import type { StoredObjectApi } from "@langwatch/stored-object-contract";
import { nowInstant } from "@langwatch/time";
import {
  USER_AVATAR_OWNER_KIND,
  USER_AVATAR_PURPOSE,
  UserCapabilityUnavailableError,
} from "@langwatch/user-contract";
import { hash, compare } from "bcrypt";

import { PrismaUserOrganizationDirectoryRepository } from "../repositories/prisma/prisma.user-organization-directory.repository.ts";
import type { UserBudgetRequestMailer, UserInfrastructure } from "./user.members.ts";

/** What this process hands `UserApp` at boot. */
export function buildUserInfrastructure(input: {
  prisma: ProcessMembers["prisma"];
  redis: RedisConnection;
  organizations: OrganizationApi;
  enterpriseGateway: Pick<
    EnterpriseGatewayApi,
    "findDefaultRoutingPolicies" | "personalVirtualKeyList"
  >;
  gateway: Pick<GatewayApi, "checkBudget">;
  auth: Pick<AuthApi, "revokeCliTokens">;
  projects: Pick<ProjectApi, "findInternal">;
  governance: Pick<GovernanceRestApi, "personalUsage">;
  mail: MailSender;
  publicBaseUrl: string | undefined;
  storedObjects: Pick<StoredObjectApi, "storeFromBytes" | "readById">;
}): UserInfrastructure {
  const { prisma, redis, organizations, enterpriseGateway, gateway } = input;
  const { auth, projects, governance, mail, publicBaseUrl, storedObjects } = input;

  return {
    ...avatarObjectStore(storedObjects),
    // The stored-password format, stated ONCE for this process. Both halves
    // of a rotation run through it, and the credential service (the only
    // holder of a stored hash) is built over it by the installer.
    passwords: new BcryptPasswordHasher(),
    rateLimit: new RedisUserRateLimiter(redis).check,
    // The product-analytics sink is the deployment's. Absent, and silent on
    // purpose: an analytics write has never been allowed to fail a request.
    analytics: { trackServerEvent: () => undefined },
    // Main's CliTokenRevocationService.revokeForUser: auth owns the CLI tokens.
    cliCredentials: {
      revokeForUser: async ({ userId }) => {
        await auth.revokeCliTokens({ userId });
      },
    },
    organizations: organizationDirectory({
      directory: PrismaUserOrganizationDirectoryRepository.create(prisma),
      organizations,
    }),
    // Main's findHiddenGovernanceProject: read-only, never provisioned on a read.
    governanceProjects: {
      findGovernanceProject: ({ organizationId }) =>
        projects.findInternal({ organizationId, kind: PROJECT_KIND.INTERNAL_GOVERNANCE }),
    },
    // Main's resolveDefaultForUser, personal virtual keys and budget check.
    gateway: {
      findDefaultRoutingPolicy: async (policyInput) =>
        (await enterpriseGateway.findDefaultRoutingPolicies(policyInput))[0] ?? null,
      listPersonalVirtualKeys: (keysInput) => enterpriseGateway.personalVirtualKeyList(keysInput),
      checkBudget: (budgetInput) => gateway.checkBudget(budgetInput),
    },
    budgetRequests: budgetRequestMailer({ mail, publicBaseUrl }),
    // The spend rollup behind `/api/me/usage`, main's PersonalUsageService.
    personalUsage: {
      personalUsage: (usageInput) => governance.personalUsage(usageInput),
    },
  };
}

/** The deployment's delivery audience for an avatar: any viewer of the project it sits in. */
const AVATAR_AUDIENCE = "project:view";

/**
 * Main's avatar objects: bytes kept as a user-owned object in the uploader's
 * personal project. A read of a row that is not there answers nothing, and
 * the avatar door turns that into its one refusal.
 */
export function avatarObjectStore(
  storedObjects: Pick<StoredObjectApi, "storeFromBytes" | "readById">,
): Pick<UserInfrastructure, "avatarStorage" | "avatarObjects"> {
  return {
    avatarStorage: {
      store: async ({ projectId, userId, mediaType, bytes }) => {
        const { reference } = await storedObjects.storeFromBytes({
          projectId,
          filename: "avatar",
          mediaType,
          bytes,
          audience: AVATAR_AUDIENCE,
          purpose: USER_AVATAR_PURPOSE,
          ownerKind: USER_AVATAR_OWNER_KIND,
          ownerId: userId,
        });

        return { id: reference.id };
      },
    },
    avatarObjects: {
      findById: async (input) => {
        const read = await storedObjects.readById(input).catch((error: unknown) => {
          if (HandledError.isHandled(error) && error.code === "stored_object_not_found")
            return null;
          throw error;
        });
        if (!read) return null;

        const metadata = {
          byteLength: read.row.size_bytes,
          mediaType: read.row.media_type,
          purpose: read.row.purpose,
          ownerKind: read.row.owner_kind,
        };
        if ("status" in read) return { status: "missing", metadata };

        return { status: "available", metadata, stream: ReadableStream.from(read.stream) };
      },
    },
  };
}

/**
 * Main's budget-increase mail, linking the administrator to the gateway's
 * budgets page on this deployment. With no public base URL there is no page
 * to link, so it refuses by name.
 */
export function budgetRequestMailer(input: {
  mail: MailSender;
  publicBaseUrl: string | undefined;
}): UserBudgetRequestMailer {
  const { mail, publicBaseUrl } = input;
  if (!publicBaseUrl) {
    const refusal = "public base URL, so it cannot link the budget increase request";

    return { sendBudgetIncreaseRequest: () => Promise.reject(unavailable(refusal)) };
  }

  return {
    sendBudgetIncreaseRequest: (request) =>
      sendBudgetIncreaseRequestEmail({
        mailer: mail,
        ...request,
        budgetsUrl: `${publicBaseUrl}/gateway/budgets`,
      }),
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

/**
 * The signed-in person: `user.*` beside `identity.*`, the ceremony that spends
 * a magic link. The browser-session service installs on the SAME runtime: Auth
 * reads the person here, and this application ends their sessions through it.
 */
import { compare, hash } from "bcrypt";
import type { AuthApi } from "@langwatch/auth-contract";
import { HandledError } from "@langwatch/handled-error";
import {
  BetterAuthAccountQueriesAdapter,
  IdentityEventingPort,
  IdentityLedgerWriterAdapter,
  IdentityService,
  PostgresIdentityGuardsAdapter,
  PrismaIdentityHeadsRepository,
  PrismaIdentityProjectionRepository,
  PrismaIdentityVerificationRepository,
  VerificationCeremonyService,
} from "@langwatch/identity-server";
import { createLogger } from "@langwatch/observability";
import { AdminAccessService } from "@langwatch/ops-server";
import { OpsApi } from "@langwatch/ops-contract";
import { OrganizationApi, type OrganizationService } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { RedisConnection } from "@langwatch/redis-client";
import { createApp } from "@langwatch/runtime-composition";
import { UserApi } from "@langwatch/user-contract";
import {
  userServer,
  type UserAvatarObjects,
  type UserAvatarStorage,
  type UserInfrastructure,
  type UserPersonalUsageReader,
} from "@langwatch/user-server";

import type { ApiPersonMailPort } from "../../app/api-person-mail.port.ts";
import { authServer } from "@langwatch/auth-server";
import {
  apiAuthInfrastructure,
  type ApiPersonDeploymentFacts,
} from "../auth/auth.composition.ts";
import { createIdentityTrpcRouter, createUserTrpcRouter } from "./user-trpc.mount.ts";

import type { ComposedUserFeature } from "./user.composition.types.ts";

/** The other services the signed-in person's surfaces reach. */
export type UserPeers = Readonly<{
  /** The organization directory the support-contact read resolves through. */
  organizations: OrganizationService;
  /** The project a calling API key belongs to, for `/api/me/project`. */
  projects: Pick<ProjectApi, "findIdentity">;
  /** ADR-027's mode, resolved once by the feature that owns the signed-out doors. */
  resolveAuthProvider(): Promise<string>;
}>;

/** Installs the signed-in person's two namespaces over this process's graph. */
export async function installApiUser(options: {
  /** The one guarded connection every row read below runs on. */
  prisma: PrismaClient;
  peers: UserPeers;
  /** The event stack the identifier ledger appends and stages through. */
  eventing: IdentityEventingPort;
  /** Better Auth's own session cache, so a revocation clears what it reads. */
  redis?: RedisConnection | null | undefined;
  /** The shared counter the account throttles meter through. */
  rateLimit(
    input: Readonly<{ key: string; windowSeconds: number; max: number }>,
  ): Promise<Readonly<{ allowed: boolean; resetAt: number }>>;
  /** The deployment's own answers; see {@link ApiPersonDeploymentFacts}. */
  deployment: ApiPersonDeploymentFacts;
  /** Where an uploaded avatar's bytes go. */
  avatarStorage: UserAvatarStorage;
  /** One avatar object's row and, when the bytes are there, a stream of them. */
  avatarObjects: UserAvatarObjects;
  /** One person's own AI usage, where this deployment composed a spend ledger. */
  personalUsage?: (() => UserPersonalUsageReader | undefined) | undefined;
  /** The budget request this feature sends, where the deployment composed a gateway. */
  mail?:
    | Pick<ApiPersonMailPort, "sendBudgetIncreaseRequest" | "sendSignUpVerificationLink">
    | undefined;
  /** Names this process in every refusal below. */
  processName: string;
}): Promise<ComposedUserFeature> {
  const { prisma, deployment, processName } = options;
  const { organizations, projects } = options.peers;
  const logger = createLogger("langwatch:api:user");
  const unavailable = (capability: string) =>
    new ApiUserUnavailableError({ capability, processName });

  const adminAccess = AdminAccessService.create({
    adminEmails: deployment.adminEmails ?? [],
  });

  const runtime = await createApp({ name: "langwatch-api" })
    .withPersistence("postgres", { prisma })
    .withInfrastructure({})
    .withProvided(OrganizationApi, organizations)
    .withProvided(OpsApi, adminAccess)
    // Auth installs on the SAME runtime, which is what resolves the cycle:
    // auth reads the person through `UserApi` and the user application ends
    // their sessions through `AuthApi`.
    .withModule(authServer, {
      infrastructure: apiAuthInfrastructure({
        prisma,
        redis: options.redis ?? null,
        rateLimit: options.rateLimit,
        deployment,
        ...(options.mail ? { mail: options.mail } : {}),
        processName,
      }),
    })
    .withModule(userServer, {
      infrastructure: userInfrastructure({
        ...options,
        logger,
        unavailable,
        organizations,
        projects,
      }),
    })
    .boot({ role: "api" });

  const app = runtime.module(userServer).provided;
  const auth = runtime.module(authServer).provided;

  return {
    app,
    auth,
    config: { opsSidebarEmails: AdminAccessService.parseEmails(deployment.adminEmails ?? []) },
    routers: (mount) => ({
      user: createUserTrpcRouter(mount.runtime),
      identity: createIdentityTrpcRouter(mount.runtime),
    }),
  };
}

/**
 * The signed-in person's namespaces on a process that composed no user directory. Both
 * still mount and every call refuses by name, so a person is told the deployment cannot
 * read their account rather than shown an empty one.
 */
export function refusingUserFeature(processName: string): ComposedUserFeature {
  const refuse = (): never => {
    throw new ApiUserUnavailableError({ capability: "user directory", processName });
  };
  const refusing = <T>(): T => new Proxy({}, { get: () => refuse, has: () => true }) as T;

  return {
    app: refusing<UserApi>(),
    auth: refusing<AuthApi>(),
    config: {},
    routers: (mount) => ({
      user: createUserTrpcRouter(mount.runtime),
      identity: createIdentityTrpcRouter(mount.runtime),
    }),
  };
}

/** What this process supplies the user module, once, at boot. */
function userInfrastructure(options: {
  prisma: PrismaClient;
  organizations: OrganizationService;
  projects: Pick<ProjectApi, "findIdentity">;
  peers: UserPeers;
  deployment: ApiPersonDeploymentFacts;
  eventing: IdentityEventingPort;
  avatarStorage: UserAvatarStorage;
  avatarObjects: UserAvatarObjects;
  personalUsage?: (() => UserPersonalUsageReader | undefined) | undefined;
  mail?: Pick<ApiPersonMailPort, "sendBudgetIncreaseRequest"> | undefined;
  rateLimit(
    input: Readonly<{ key: string; windowSeconds: number; max: number }>,
  ): Promise<Readonly<{ allowed: boolean; resetAt: number }>>;
  logger: ReturnType<typeof createLogger>;
  unavailable: (capability: string) => ApiUserUnavailableError;
}): UserInfrastructure {
  const { prisma, organizations, projects, deployment, logger, unavailable } = options;

  return {
    // The issuer a credential account row is stored under is a persisted
    // format, so it is minted by the package that owns the format rather than
    // restated here.
    credentialIssuer: BetterAuthAccountQueriesAdapter.issuerForProviderId("credential"),
    avatarStorage: options.avatarStorage,
    avatarObjects: options.avatarObjects,
    // The stored-password format, stated ONCE for this process. Both halves of
    // a rotation run through it, and the credential service (the only holder
    // of a stored hash) is built over it by the installer.
    passwords: new BcryptPasswordHasher(),
    deployment: {
      authProvider: () => options.peers.resolveAuthProvider(),
      offersPasskeys: () => deployment.passkeysEnabled === true,
      findBaseUrl: () => deployment.baseUrl ?? null,
    },
    rateLimit: options.rateLimit,
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
    organizations: {
      isMember: async ({ userId, organizationId }) =>
        (await prisma.organizationUser.findUnique({
          where: { userId_organizationId: { userId, organizationId } },
        })) !== null,
      findSupportContact: async ({ organizationId }) => {
        const settings = await organizations.getSettings({ organizationId });
        if (settings.supportContact) return settings.supportContact;

        return await firstAdminEmail(prisma, organizationId);
      },
      getBudgetIncreaseRecipient: async ({ organizationId }) => {
        const adminEmail = await firstAdminEmail(prisma, organizationId);
        if (!adminEmail) {
          logger.warn(
            { organizationId },
            "budget increase requested but the organization has no admin",
          );
          throw unavailable("administrator for this organization to send the request to");
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
    },
    projects: {
      findById: ({ projectId }) => projects.findIdentity(projectId),
      // The organization's hidden governance project is minted by Enterprise
      // governance, which this process does not compose. Absent is the honest
      // answer and the one the module already handles.
      findGovernanceProject: () => Promise.resolve(null),
    },
    // The gateway's own stores. All three are Enterprise, and all three refuse
    // rather than answering: a budget pre-check that answered "allowed"
    // without a store would let spend through unmetered.
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
      sendBudgetIncreaseRequest: async (input) => {
        const mail = options.mail;
        if (!mail || !deployment.baseUrl) {
          throw unavailable(
            "mail gateway with a public base URL, so it cannot send the budget increase request",
          );
        }

        await mail.sendBudgetIncreaseRequest({
          ...input,
          budgetsUrl: `${deployment.baseUrl.replace(/\/$/, "")}/gateway/budgets`,
        });
      },
    },
    verification: verificationCeremony({ prisma, eventing: options.eventing }),
    personalUsage: {
      personalUsage: (input) => {
        const reader = options.personalUsage?.();
        if (!reader) {
          throw unavailable("spend ledger, so it cannot roll up this person's own AI usage");
        }

        return reader.personalUsage(input);
      },
    },
  };
}

/** The identifier ledger, and the ceremony that spends a magic link. */
function verificationCeremony(options: {
  prisma: PrismaClient;
  eventing: IdentityEventingPort;
}): UserInfrastructure["verification"] {
  const { prisma } = options;
  const guards = PostgresIdentityGuardsAdapter.create({ database: prisma }).build();
  const ceremony = VerificationCeremonyService.create(
    new PrismaIdentityVerificationRepository(prisma),
    PrismaIdentityHeadsRepository.create(prisma),
    IdentityService.create(
      guards.identityGuards,
      IdentityLedgerWriterAdapter.create({
        // The SAME address lock the guards claim through (ADR-116 §6): the
        // guards claim before stating a fact and the fold releases once no
        // live identifier of that user carries the value, so a second lock
        // instance here would release something this process never claimed.
        projectionStore: new PrismaIdentityProjectionRepository(prisma, guards.reservations),
        eventing: options.eventing,
      }),
    ),
    // The identifier projection IS the answer here: this process composes no
    // legacy branch to fall back to.
    { isLatched: () => Promise.resolve(true) },
  );

  return { completeEmailVerification: (input) => ceremony.completeEmailVerification(input) };
}

/** The bcrypt cost every stored credential in this database was written at. */
const PASSWORD_HASH_COST = 10;

/**
 * The stored password format, stated ONCE for this process. bcrypt at cost 10, which is
 * what every credential row in the database already carries.
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
 * The organization's first administrator, by seat age. A row read with the organization
 * id already in hand, which is why it lives here beside the other reads this feature
 * answers from its own connection rather than behind a port.
 */
async function firstAdminEmail(
  prisma: PrismaClient,
  organizationId: string,
): Promise<string | null> {
  const admin = await prisma.organizationUser.findFirst({
    where: { organizationId, role: "ADMIN", disabledAt: null },
    orderBy: { createdAt: "asc" },
    select: { user: { select: { email: true } } },
  });

  return admin?.user.email ?? null;
}

/**
 * A capability this deployment does not hold. `fault: "platform"` because nothing the
 * customer sent caused it, and the message names which capability and which process.
 */
export class ApiUserUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(input: { capability: string; processName: string }) {
    super("service_unavailable", `${input.processName} composes no ${input.capability}.`, {
      httpStatus: 503,
      fault: "platform",
      meta: { capability: input.capability },
    });
    this.name = "ApiUserUnavailableError";
  }
}

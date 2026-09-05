/**
 * The signed-in person: `user.*` — their account, their sign-in methods and the
 * two requests they make of their administrator — beside `identity.*`, the
 * ceremony that spends a magic link.
 *
 * Two namespaces and one application, because they are one graph. The user
 * directory the browser session resolves through is the SAME one `user.*` reads
 * an account off and the verification ceremony states an identifier on, so this
 * feature takes the already-composed service rather than building a second
 * answer to "who is this person".
 *
 * ## What refuses by name
 *
 * The capabilities that are Enterprise-licensed or belong to a tier this
 * process does not compose are each a NAMED refusal rather than a value that
 * pretends: the CLI-token revocation and the gateway's routing, key and budget
 * reads are Enterprise, and an Auth0 password change needs tenant credentials
 * this process holds none of. Each raises an error naming the capability and
 * the process, so a customer's failure is traceable to a deployment shape
 * rather than to their input.
 *
 * The product-analytics sink is the one silent absence, and deliberately: an
 * analytics write has never been allowed to fail a request.
 */
import { compare, hash } from "bcrypt";
import type { AuthService } from "@langwatch/auth-contract";
import { HandledError } from "@langwatch/handled-error";
import {
  IdentityEventingPort,
  IdentityLedgerWriter,
  IdentityService,
  PostgresIdentityGuardsAdapter,
  PrismaIdentityHeadsRepository,
  PrismaIdentityProjectionRepository,
  PrismaIdentityVerificationRepository,
  VerificationCeremonyService,
} from "@langwatch/identity-server";
import { createLogger } from "@langwatch/observability";
import { AdminAccessService } from "@langwatch/ops-server";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { UserService } from "@langwatch/user-contract";
import {
  PostgresUserCredentialAdapter,
  UserApp,
  UserPasswordHasherPort,
  type IdentityTrpcPorts,
  type UserTrpcPorts,
} from "@langwatch/user-server";

import type { ApiTrpcFeatureMount } from "../../api.application";
import type { ApiPersonMailPort } from "../../app/api-person-mail.port";
import type { ApiTrpcFeatureApplication } from "../../app-trpc/app-trpc.context";
import type { ApiPersonDeploymentFacts } from "../auth/auth.composition";
import { createIdentityTrpcRouter, createUserTrpcRouter } from "./user-trpc.mount";

/** The two namespaces this feature mounts, and the slices behind them. */
export type ComposedUserFeature = Readonly<{
  /** The `ctx.app.users` slice. */
  app: UserApp;
  /**
   * The operator allow-list this deployment names, in the shape `ctx.app.ops`
   * carries. Published for the retention gate, so "who may keep data forever"
   * and "who sees the operator sidebar" are never two answers.
   */
  ops: ApiTrpcFeatureApplication["ops"];
  /** The `ctx.app.config` slice: the same allow-list, parsed once. */
  config: ApiTrpcFeatureApplication["config"];
  /**
   * The two port groups the namespaces are built on.
   *
   * Published beside the routers because they are this feature's contract with
   * its transport: the credential seam — which reads are the feature's own and
   * what crosses the port — is stated on them rather than on a wire call.
   */
  ports: Readonly<{ identity: IdentityTrpcPorts; user: UserTrpcPorts }>;
  routers(mount: ApiTrpcFeatureMount): Readonly<{
    identity: ReturnType<typeof createIdentityTrpcRouter>;
    user: ReturnType<typeof createUserTrpcRouter>;
  }>;
}>;

/** The other services the signed-in person's surfaces reach. */
export type UserPeers = Readonly<{
  /** The user directory the browser-session boundary already composed. */
  users: UserService;
  /** The Auth service the same boundary composed, for the account's own sessions. */
  auth: AuthService;
  /** The organization directory the support-contact read resolves through. */
  organizations: OrganizationService;
  /** ADR-027's mode, resolved once by the feature that owns the signed-out doors. */
  resolveAuthProvider(): Promise<string>;
}>;

/** Composes the signed-in person's two namespaces over this process's graph. */
export function composeUserFeature(options: {
  /** The one guarded connection every row read below runs on. */
  prisma: PrismaClient;
  peers: UserPeers;
  /** The event stack the identifier ledger appends and stages through. */
  eventing: IdentityEventingPort;
  /** The shared counter the account throttles meter through. */
  rateLimit(
    input: Readonly<{ key: string; windowSeconds: number; max: number }>,
  ): Promise<Readonly<{ allowed: boolean; resetAt: number }>>;
  /** The deployment's own answers; see {@link ApiPersonDeploymentFacts}. */
  deployment: ApiPersonDeploymentFacts;
  /** The budget request this feature sends, where the deployment composed a gateway. */
  mail?: Pick<ApiPersonMailPort, "sendBudgetIncreaseRequest"> | undefined;
  /** Names this process in every refusal below. */
  processName: string;
}): ComposedUserFeature {
  const { prisma, deployment, mail, processName } = options;
  const { users, auth, organizations, resolveAuthProvider } = options.peers;
  const logger = createLogger("langwatch:api:user");
  const unavailable = (capability: string) =>
    new ApiUserUnavailableError({ capability, processName });

  // The stored-password format, and the user feature's own reader over the
  // rows it is stored on. Composed AT ALL because the four answers it serves
  // used to be `prisma.account` statements written in the API's tRPC ports
  // composition, one of them selecting the hash itself.
  const passwords = new BcryptPasswordHasher();
  const credentials = PostgresUserCredentialAdapter.create({
    database: prisma,
    passwords,
  }).build();

  const adminAccess = AdminAccessService.create({
    adminEmails: deployment.adminEmails ?? [],
  });

  const app = UserApp.create({ users, auth, ops: adminAccess, organizations });

  // The identifier ledger, and the ceremony that spends a magic link.
  const guards = PostgresIdentityGuardsAdapter.create({ database: prisma }).build();
  const verificationCeremony = new VerificationCeremonyService(
    new PrismaIdentityVerificationRepository(prisma),
    PrismaIdentityHeadsRepository.create(prisma),
    new IdentityService(
      guards.identityGuards,
      new IdentityLedgerWriter({
        // The SAME address lock the guards claim through (ADR-116 §6): the
        // guards claim before stating a fact and the fold releases once no
        // live identifier of that user carries the value, so a second lock
        // instance here would release something this process never claimed.
        projectionStore: new PrismaIdentityProjectionRepository(prisma, guards.reservations),
        eventing: options.eventing,
      }),
    ),
    // The per-user fork, as this process reads it: the identifier projection
    // IS the answer here, because the process composes no legacy branch to
    // fall back to.
    { isLatched: () => Promise.resolve(true) },
  );

  const identityPorts: IdentityTrpcPorts = {
    completeEmailVerification: (input) => verificationCeremony.completeEmailVerification(input),
  };

  const userPorts: UserTrpcPorts = {
    resolveAuthProvider,
    deploymentOffersPasskeys: () => deployment.passkeysEnabled === true,
    appBaseUrl: () => deployment.baseUrl ?? null,
    clientIp: (ctx: unknown) => (ctx as { clientIp?: () => string }).clientIp?.() ?? "unknown",
    rateLimit: async (input) => ({ allowed: (await options.rateLimit(input)).allowed }),
    // The product-analytics sink is the deployment's. Absent, and silent on
    // purpose: an analytics write has never been allowed to fail a request.
    trackServerEvent: () => undefined,

    /**
     * The FIRST password a sign-up or `setPassword` writes. There is nothing
     * to compare against on either path, so this is a mint rather than a
     * rotation — {@link BcryptPasswordHasher} is the same format either way.
     */
    hashPassword: ({ password }: { password: string }) => passwords.hash({ password }),

    /**
     * The four account-row answers, through this feature's own persistence.
     *
     * They were `prisma.account` statements in `api-trpc-ports.composition.ts`
     * — including a `select` naming `password`, the bcrypt hash a credential
     * sign-in is checked against. Nothing leaked, but the read was written
     * where no rule about that column applies. `rotatePassword` is the shape
     * that closes it: verification and replacement are one call on
     * `UserCredentialService`, so the hash it reads is compared and discarded
     * inside that service and no port above it is ever handed one.
     */
    rotatePassword: (
      _ctx: unknown,
      input: Readonly<{ userId: string; currentPassword: string; newPassword: string }>,
    ) => credentials.rotatePassword(input),

    tryFindAuth0DatabaseAccount: (_ctx: unknown, input: Readonly<{ userId: string }>) =>
      credentials.tryFindAuth0DatabaseAccount(input),

    listLinkedAccounts: (_ctx: unknown, input: Readonly<{ userId: string }>) =>
      credentials.listLinkedAccounts(input),

    unlinkAccount: (_ctx: unknown, input: Readonly<{ userId: string; accountId: string }>) =>
      credentials.unlinkAccount(input),

    /**
     * The Auth0 tenant is the deployment's own, and changing a password in it
     * is an API call against credentials this process does not hold.
     */
    changeAuth0Password: () =>
      Promise.reject(
        unavailable("Auth0 tenant credentials, so it cannot change an Auth0 password"),
      ),

    /**
     * CLI tokens are an Enterprise governance capability. It refuses rather
     * than returning: a deactivation that silently left the person's CLI
     * credentials live would be the failure this call exists to prevent.
     */
    revokeCliTokensForUser: () =>
      Promise.reject(
        unavailable("Enterprise governance service, so it cannot revoke this user's CLI tokens"),
      ),

    tryResolveSupportContact: async (_ctx, { organizationId }) => {
      const settings = await organizations.getSettings({ organizationId });
      if (settings.supportContact) return settings.supportContact;
      return await firstAdminEmail(prisma, organizationId);
    },

    resolveBudgetIncreaseRecipient: async (_ctx, { organizationId }) => {
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

    sendBudgetIncreaseRequest: async (_ctx, input) => {
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

    // The gateway's own stores. All three are Enterprise, and all three
    // refuse rather than answering: a budget pre-check that answered
    // "allowed" without a store would let spend through unmetered.
    tryResolveDefaultRoutingPolicy: () =>
      Promise.reject(
        unavailable("Enterprise gateway governance, so it holds no default routing policy"),
      ),
    listPersonalVirtualKeys: () =>
      Promise.reject(
        unavailable("Enterprise gateway governance, so it holds no personal gateway keys"),
      ),
    checkBudget: () =>
      Promise.reject(unavailable("Enterprise gateway budget store, so it cannot check a budget")),

    /**
     * The `User` rows behind the /me screens, the organization membership
     * probe and the first-project slug. Every one is a row read with a project
     * or user id already in hand, which is why they moved with the connection
     * rather than staying behind a port — and `Account`, the table the stored
     * password hash lives on, is not among them.
     */
    emailIsTaken: async (_ctx: unknown, { email }: Readonly<{ email: string }>) =>
      (await prisma.user.findFirst({
        where: { email: { equals: email, mode: "insensitive" } },
      })) !== null,

    isOrganizationMember: async (
      _ctx: unknown,
      { userId, organizationId }: Readonly<{ userId: string; organizationId: string }>,
    ) =>
      (await prisma.organizationUser.findUnique({
        where: { userId_organizationId: { userId, organizationId } },
      })) !== null,

    tryGetOrganizationName: async (
      _ctx: unknown,
      { organizationId }: Readonly<{ organizationId: string }>,
    ) =>
      (
        await prisma.organization.findUnique({
          where: { id: organizationId },
          select: { name: true },
        })
      )?.name ?? null,

    tryGetUserContact: (_ctx: unknown, { userId }: Readonly<{ userId: string }>) =>
      prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, name: true },
      }),

    tryFindFirstProjectSlug: async (
      _ctx: unknown,
      { organizationId, userId }: Readonly<{ organizationId: string; userId: string }>,
    ) =>
      (
        await prisma.project.findFirst({
          where: {
            team: { organizationId, members: { some: { userId } } },
            archivedAt: null,
          },
          orderBy: { createdAt: "asc" },
          select: { slug: true },
        })
      )?.slug ?? null,
  } as UserTrpcPorts;

  return {
    app,
    ops: adminAccess as unknown as ApiTrpcFeatureApplication["ops"],
    config: { opsSidebarEmails: AdminAccessService.parseEmails(deployment.adminEmails ?? []) },
    ports: { identity: identityPorts, user: userPorts },
    routers: (mount) => ({
      identity: createIdentityTrpcRouter({ ...mount, ports: identityPorts }),
      user: createUserTrpcRouter({ ...mount, ports: userPorts }),
    }),
  };
}

/**
 * The signed-in person's namespaces on a process that composed no user
 * directory.
 *
 * Both still mount and every call refuses by name, so a person is told the
 * deployment cannot read their account rather than shown an empty one.
 */
export function refusingUserFeature(processName: string): ComposedUserFeature {
  const refuse = (): never => {
    throw new ApiUserUnavailableError({ capability: "user directory", processName });
  };
  const refusing = <T>(): T => new Proxy({}, { get: () => refuse, has: () => true }) as T;
  const ports = {
    identity: refusing<IdentityTrpcPorts>(),
    user: refusing<UserTrpcPorts>(),
  };

  return {
    app: refusing<UserApp>(),
    ops: refusing<ApiTrpcFeatureApplication["ops"]>(),
    config: {},
    ports,
    routers: (mount) => ({
      identity: createIdentityTrpcRouter({ ...mount, ports: ports.identity }),
      user: createUserTrpcRouter({ ...mount, ports: ports.user }),
    }),
  };
}

/** The bcrypt cost every stored credential in this database was written at. */
const PASSWORD_HASH_COST = 10;

/**
 * The stored password format, stated ONCE for this process.
 *
 * bcrypt at cost 10, which is what every credential row in the database
 * already carries. The cost is spelled here rather than taken from
 * configuration on purpose — it is part of the stored format, and a process
 * that hashed at a different cost would write rows the other tier's
 * verification still reads but whose cost nobody can account for.
 *
 * A port implementation rather than two loose closures because the comparison
 * has one caller: `UserCredentialService`, which is the only code in the
 * deployment that ever holds a stored hash.
 */
class BcryptPasswordHasher extends UserPasswordHasherPort {
  hash({ password }: { password: string }): Promise<string> {
    return hash(password, PASSWORD_HASH_COST);
  }

  matches({ password, hash: stored }: { password: string; hash: string }): Promise<boolean> {
    return compare(password, stored);
  }
}

/**
 * The organization's first administrator, by seat age.
 *
 * A row read with the organization id already in hand, which is why it lives
 * here beside the other reads this feature answers from its own connection
 * rather than behind a port.
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
 * A capability this deployment does not hold.
 *
 * `fault: "platform"` because nothing the customer sent caused it, and the
 * message names which capability and which process.
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

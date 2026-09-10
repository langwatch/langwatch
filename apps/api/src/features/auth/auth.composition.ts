/**
 * The auth module as this process installs it: the browser session every other
 * door verifies through, and the signed-out `frontDoor.*` surface.
 *
 * Everything supplied here is the PROCESS's rather than auth's - the counter,
 * the sign-in router, the mail gateway, the account rows and the invitation
 * reads all run over tables another module owns - so the module takes them as
 * infrastructure and reaches nothing around its own two tables.
 */
import type { AuthApi, InviteLanding } from "@langwatch/auth-contract";
import {
  AuthUnavailableError,
  PrismaSignUpAccountDirectoryRepository,
  type AuthInfrastructure,
  type AuthInviteDirectory,
  type AuthSignUpCollaborators,
} from "@langwatch/auth-server";
import {
  InProcessBreakGlassLimiterAdapter,
  LegacySsoDomainRoutingRepository,
  PostgresIdentityEmailAdapter,
  SignInMethodPolicyService,
  SignInRouterService,
  SsoConnectionDomainRoutingRepository,
} from "@langwatch/identity-server";
import { InviteExpiredError, InviteNotFoundError } from "@langwatch/organization-contract";
import { resolveInviteDisplayStatus } from "@langwatch/organization-server";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { RedisConnection } from "@langwatch/redis-client";

import type { ApiPersonMail } from "../../app/api-person-mail.port.ts";

import { createFrontDoorTrpcRouter } from "./auth-trpc.mount.ts";
import type { ComposedAuthFeature } from "./auth.composition.types.ts";

/**
 * What the deployment answers so a person-shaped surface can be served. Five values, none
 * of them any feature's. Every one is optional and every absence has a stated consequence
 * rather than a default that pretends to be one.
 */
export type ApiPersonDeploymentFacts = Readonly<{
  /**
   * The public base URL every mailed link is built from - the confirmation link, the
   * members page an admin is pointed at, the budgets page.
   */
  baseUrl?: string | undefined;
  /**
   * `"email"`, or the federated provider id this deployment mounted.
   * Absent means email mode: ADR-027's single source of truth, and this
   * process composes none of the federated door without a licence gate.
   */
  authProvider?: string | undefined;
  /** Whether the deployment registered the passkey plugin at boot. */
  passkeysEnabled?: boolean | undefined;
  /** Whether this is the hosted product rather than a self-hosted install. */
  isSaas?: boolean | undefined;
  /**
   * The addresses that see the operator entry in the sidebar and pass
   * `ops.isAdmin`. A comma-separated string, exactly as the deployment
   * configures it.
   */
  adminEmails?: string | readonly string[] | undefined;
}>;

/**
 * The deployment facts as this process resolves them: a host that composed the
 * process may state them, and where it named no operator list the install's own
 * `ADMIN_EMAILS` answers. Nothing states them in production, so an unresolved
 * list made `ops.isAdmin` false for everybody and hid the whole back office.
 */
export function resolvePersonDeploymentFacts(options: {
  supplied: ApiPersonDeploymentFacts | undefined;
  adminEmails: string | undefined;
}): ApiPersonDeploymentFacts {
  const supplied = options.supplied ?? {};
  if (supplied.adminEmails !== undefined) return supplied;
  return options.adminEmails ? { ...supplied, adminEmails: options.adminEmails } : supplied;
}

/** What this process supplies the auth module, once, at boot. */
export function apiAuthInfrastructure(options: {
  /** The one guarded connection every row read below runs on. */
  prisma: PrismaClient;
  /** Better Auth's own session cache, so a revocation clears what it reads. */
  redis: RedisConnection | null;
  /** The shared counter the front door's throttles meter through. */
  rateLimit(
    input: Readonly<{ key: string; windowSeconds: number; max: number }>,
  ): Promise<Readonly<{ allowed: boolean; resetAt: number }>>;
  /** The deployment's own answers; see {@link ApiPersonDeploymentFacts}. */
  deployment: ApiPersonDeploymentFacts;
  /** The confirmation link this feature sends, where the deployment composed a gateway. */
  mail?: Pick<ApiPersonMail, "sendSignUpVerificationLink"> | undefined;
  /** Names this process in every refusal below. */
  processName: string;
}): AuthInfrastructure {
  const { prisma, deployment, processName } = options;
  const authProvider = () => Promise.resolve(deployment.authProvider ?? "email");

  return {
    redis: options.redis,
    identityEmails: PostgresIdentityEmailAdapter.create({ database: prisma }).build(),
    rateLimit: async (input) => ({ allowed: (await options.rateLimit(input)).allowed }),
    route: (input) => signInRouter({ prisma, deployment, authProvider }).route(input),
    signUp: signUpCollaborators(options),
    invites: apiInviteDirectory({ prisma, processName }),
    authProvider,
    processName,
  };
}

/**
 * The sign-up ceremony's collaborators, or nothing. Both halves are absent
 * together and that is not an accident: without a base URL a confirmation link
 * points at nowhere, and without a mail gateway it is never sent.
 */
function signUpCollaborators(options: {
  prisma: PrismaClient;
  deployment: ApiPersonDeploymentFacts;
  mail?: Pick<ApiPersonMail, "sendSignUpVerificationLink"> | undefined;
}): AuthSignUpCollaborators | null {
  const { mail, deployment } = options;
  if (!mail || !deployment.baseUrl) return null;

  return {
    accounts: PrismaSignUpAccountDirectoryRepository.create({ prisma: options.prisma }),
    mailer: {
      sendVerificationLink: async ({ email, verificationUrl }) => {
        await mail.sendSignUpVerificationLink({ email, verificationUrl });
      },
    },
    baseUrl: deployment.baseUrl,
  };
}

/**
 * The invitation an unauthenticated landing page may read, and the reissue
 * request behind it.
 *
 * A revoked invitation reads exactly like a missing one: the journey ends quietly,
 * revealing nothing about the organization or the inviter. Expired is different - it
 * is recoverable in one click by the inviter - so it gets its own named refusal.
 */
function apiInviteDirectory(options: {
  prisma: PrismaClient;
  processName: string;
}): AuthInviteDirectory {
  return {
    readLanding: async ({ inviteCode }): Promise<InviteLanding> => {
      const invite = await options.prisma.organizationInvite.findUnique({
        where: { inviteCode },
        select: {
          status: true,
          expiration: true,
          organization: { select: { name: true } },
          requestedByUser: { select: { name: true } },
        },
      });

      if (!invite || invite.status === "REVOKED") {
        throw new InviteNotFoundError("Invitation not found");
      }

      const status = resolveInviteDisplayStatus(invite);
      if (status === "EXPIRED") throw new InviteExpiredError();

      return {
        organizationName: invite.organization.name,
        inviterName: invite.requestedByUser?.name ?? null,
        alreadyAccepted: status === "ACCEPTED",
      };
    },
    /**
     * Asking an organization's admins to reissue a stale invitation goes through the
     * invitation service, which owns the throttle that stops one stale code from mailing
     * an organization repeatedly. This process composes none.
     */
    requestFresh: () =>
      Promise.reject(
        new AuthUnavailableError({
          capability:
            "invitation service, so it cannot ask this organization's admins to reissue the invitation",
          processName: options.processName,
        }),
      ),
  };
}

/**
 * Where an address signs in: the projection-backed lookup when the deployment
 * named a provider, the legacy string columns otherwise. Both answer "which
 * connection routes this domain"; `configured` is whether THIS deployment
 * mounted the method the connection names, which is the fact only the
 * deployment holds.
 */
function signInRouter(options: {
  prisma: PrismaClient;
  deployment: ApiPersonDeploymentFacts;
  authProvider: () => Promise<string>;
}): SignInRouterService {
  const { prisma, deployment, authProvider } = options;

  return SignInRouterService.create({
    domains: deployment.authProvider
      ? SsoConnectionDomainRoutingRepository.create({
          prisma,
          isMethodConfigured: async (methodId) =>
            (await SignInMethodPolicyService.tryResolveFederatedMethod(authProvider))?.id ===
            methodId,
        })
      : LegacySsoDomainRoutingRepository.create({
          prisma,
          instanceMethod: () => SignInMethodPolicyService.tryResolveFederatedMethod(authProvider),
        }),
    policy: SignInMethodPolicyService.create({
      resolveAuthProvider: authProvider,
      // No licence gate on this process, so federation is not licensed. The
      // policy reads that the way ADR-027 always did: email mode, no federated
      // method in the default set, and none reachable from a routing decision.
      federationLicensed: () => Promise.resolve(false),
      offersPasskeys: () => deployment.passkeysEnabled === true,
      selfHosted: () => deployment.isSaas !== true,
    }),
    breakGlass: InProcessBreakGlassLimiterAdapter.create(),
  });
}

/** Binds the installed application to this process's signed-out namespace. */
export function composeAuthFeature(app: AuthApi): ComposedAuthFeature {
  return {
    app,
    resolveAuthProvider: () => app.resolveAuthProvider(),
    routers: (mount) => ({
      frontDoor: createFrontDoorTrpcRouter(mount.runtime, () => app),
    }),
  };
}

/**
 * The two signed-out doors — `frontDoor.*` and the `publicEnv` procedure beside it —
 * composed as their own feature.
 */
import {
  AuthApp,
  PrismaSignUpAccountDirectoryRepository,
  PrismaSignUpVerificationTokenRepository,
  SignUpVerificationService,
} from "@langwatch/auth-server";
import { HandledError } from "@langwatch/handled-error";
import type { RoutingDecision } from "@langwatch/identity-contract";
import {
  InProcessBreakGlassLimiterAdapter,
  LegacySsoDomainRoutingRepository,
  SignInRouterService,
  SsoConnectionDomainRoutingRepository,
  SignInMethodPolicyService,
} from "@langwatch/identity-server";
import {
  InviteExpiredError,
  InviteNotFoundError,
  resolveInviteDisplayStatus,
} from "@langwatch/organization-server";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { UserService } from "@langwatch/user-contract";

import type { ApiTrpcFeatureMount } from "../../api.application";
import type { ApiPersonMailPort } from "../../app/api-person-mail.port";
import { createFrontDoorTrpcRouter, createPublicEnvTrpcProcedure } from "./auth-trpc.mount";

/**
 * What the deployment answers so a person-shaped surface can be served. Five values, none
 * of them any feature's. Every one is optional and every absence has a stated consequence
 * rather than a default that pretends to be one.
 */
export type ApiPersonDeploymentFacts = Readonly<{
  /**
   * The public base URL every mailed link is built from — the confirmation link, the
   * members page an admin is pointed at, the budgets page.
   */
  baseUrl?: string | undefined;
  /**
   * `"email"`, or the federated provider id this deployment mounted.
   * Absent means email mode: ADR-027'''s single source of truth, and this
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

/** The two signed-out doors, and the application both answer from. */
export type ComposedAuthFeature = Readonly<{
  /** The composed auth application. */
  app: AuthApp;
  /**
   * ADR-027's single source of truth for this process, published so the
   * signed-in person's own account screens report the same mode the door they
   * came through offered.
   */
  resolveAuthProvider(): Promise<string>;
  routers(mount: ApiTrpcFeatureMount): Readonly<{
    frontDoor: ReturnType<typeof createFrontDoorTrpcRouter>;
    publicEnv: ReturnType<typeof createPublicEnvTrpcProcedure>;
  }>;
}>;

/** Composes the two signed-out doors over this process's own graph. */
export function composeAuthFeature(options: {
  /** The one guarded connection every row read below runs on. */
  prisma: PrismaClient;
  /**
   * The user directory, as the browser-session boundary already composed it.
   * Taken rather than built: a second directory is a second answer to "who is
   * this person".
   */
  peers: Readonly<{ users: UserService }>;
  /** The shared counter the front door's throttle meters through. */
  rateLimit(
    input: Readonly<{ key: string; windowSeconds: number; max: number }>,
  ): Promise<Readonly<{ allowed: boolean; resetAt: number }>>;
  /** The deployment's own answers; see {@link ApiPersonDeploymentFacts}. */
  deployment: ApiPersonDeploymentFacts;
  /** The confirmation link this feature sends, where the deployment composed a gateway. */
  mail?: Pick<ApiPersonMailPort, "sendSignUpVerificationLink"> | undefined;
  /** Names this process in every refusal below. */
  processName: string;
}): ComposedAuthFeature {
  const { prisma, deployment, mail, processName } = options;
  const users = options.peers.users;
  const unavailable = (capability: string) =>
    new ApiAuthUnavailableError({ capability, processName });

  /**
   * A deployment that named a provider gets it; one that did not gets email mode.
   */
  const resolveAuthProvider = () => Promise.resolve(deployment.authProvider ?? "email");

  const signInRouter = new SignInRouterService({
    // The projection-backed lookup when the deployment named a provider, the
    // legacy string columns otherwise. Both answer "which connection routes
    // this domain"; `configured` is whether THIS deployment mounted the method
    // the connection names, which is the fact only the deployment holds.
    domains: deployment.authProvider
      ? SsoConnectionDomainRoutingRepository.create({
          prisma,
          isMethodConfigured: async (methodId) =>
            (await SignInMethodPolicyService.tryResolveFederatedMethod(resolveAuthProvider))?.id ===
            methodId,
        })
      : LegacySsoDomainRoutingRepository.create({
          prisma,
          instanceMethod: () =>
            SignInMethodPolicyService.tryResolveFederatedMethod(resolveAuthProvider),
        }),
    policy: SignInMethodPolicyService.create({
      resolveAuthProvider,
      // No licence gate on this process, so federation is not licensed. The
      // policy reads that the way ADR-027 always did: email mode, no federated
      // method in the default set, and none reachable from a routing decision.
      federationLicensed: () => Promise.resolve(false),
      offersPasskeys: () => deployment.passkeysEnabled === true,
      selfHosted: () => deployment.isSaas !== true,
    }),
    breakGlass: InProcessBreakGlassLimiterAdapter.create(),
  });

  const signUpVerification = mail
    ? SignUpVerificationService.create({
        tokens: PrismaSignUpVerificationTokenRepository.create({ prisma }),
        directory: PrismaSignUpAccountDirectoryRepository.create({ prisma }),
        mailer: {
          sendVerificationLink: async ({
            email,
            verificationUrl,
          }: {
            email: string;
            verificationUrl: string;
          }) => {
            await mail.sendSignUpVerificationLink({ email, verificationUrl });
          },
        },
        accounts: {
          // Nobody has been asked for a name on this path: the person typed an
          // address and a password into a log-in form. Onboarding asks.
          createCredentialAccount: async ({
            email,
            passwordHash,
          }: {
            email: string;
            passwordHash: string;
          }) => {
            await users.createCredentialUser({ name: null, email, passwordHash });
          },
          markAddressConfirmed: async ({ email }: { email: string }) => {
            // Case-insensitive for the same reason the lookup beside it is:
            // rows written before sign-up lowercased addresses may carry
            // capitals, and an exact match would quietly confirm nothing.
            await prisma.user.updateMany({
              where: { email: { equals: email, mode: "insensitive" } },
              data: { emailVerified: true },
            });
          },
        },
        buildVerificationUrl: ({ token }) =>
          `${deployment.baseUrl ?? ""}/auth/signup?verify=${encodeURIComponent(token)}`,
      })
    : undefined;

  /**
   * The ceremony, or the refusal that names why there is none. Both halves of it are
   * absent together and that is not an accident: without a base URL a confirmation link
   * points at nowhere, and without a mail gateway it is never sent.
   */
  const requireSignUpVerification = (): SignUpVerificationService => {
    if (!signUpVerification || !deployment.baseUrl) {
      throw unavailable(
        "mail gateway with a public base URL, so it cannot send a sign-up confirmation link",
      );
    }
    return signUpVerification;
  };

  const app = AuthApp.create({
    // The front door is unauthenticated, so the caller's address is the only
    // thing the throttle can key on — and this process reads it from the
    // request the transport already resolved rather than from a header a
    // client controls.
    clientIp: (ctx: unknown) => (ctx as { clientIp?: () => string }).clientIp?.() ?? "unknown",
    rateLimit: async (input) => ({ allowed: (await options.rateLimit(input)).allowed }),
    route: (input): Promise<RoutingDecision> => signInRouter.route(input),
    addressIsRegistered: (_ctx, input) => requireSignUpVerification().addressIsRegistered(input),
    requestSignUpVerification: (_ctx, input) =>
      requireSignUpVerification().requestVerification(input),
    completeSignUpVerification: (_ctx, input) =>
      requireSignUpVerification().completeVerification(input),

    /**
     * A revoked invitation reads exactly like a missing one: the journey ends quietly,
     * revealing nothing about the organization or the inviter. Expired is different — it
     * is recoverable in one click by the inviter — so it gets its own named refusal.
     */
    readInviteLanding: async (_ctx, { inviteCode }) => {
      const invite = await prisma.organizationInvite.findUnique({
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
     * an organization repeatedly.
     */
    requestFreshInvite: () =>
      Promise.reject(
        unavailable(
          "invitation service, so it cannot ask this organization's admins to reissue the invitation",
        ),
      ),

    resolveAuthProvider,
  });

  return { app, resolveAuthProvider, routers: (mount) => authRouters(mount, app) };
}

/**
 * The two signed-out doors on a process that composed no user directory. Both still mount
 * and every call refuses by name.
 */
export function refusingAuthFeature(processName: string): ComposedAuthFeature {
  const refuse = (): never => {
    throw new ApiAuthUnavailableError({ capability: "sign-in ceremony", processName });
  };
  const app = new Proxy({}, { get: () => refuse, has: () => true }) as AuthApp;

  return {
    app,
    resolveAuthProvider: () => Promise.resolve("email"),
    routers: (mount) => authRouters(mount, app),
  };
}

function authRouters(mount: ApiTrpcFeatureMount, app: AuthApp) {
  return {
    frontDoor: createFrontDoorTrpcRouter({ ...mount, ports: app }),
    // A procedure rather than a router: the client calls `publicEnv({})` at
    // the root, and giving it a namespace would rename it.
    publicEnv: createPublicEnvTrpcProcedure({ ...mount, ports: app }),
  };
}

/**
 * A capability this deployment does not hold. `fault: "platform"` because nothing the
 * customer sent caused it, and the message names which capability and which process, so a
 * support conversation starts from the deployment shape rather than from a stack trace.
 */
export class ApiAuthUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(input: { capability: string; processName: string }) {
    super("service_unavailable", `${input.processName} composes no ${input.capability}.`, {
      httpStatus: 503,
      fault: "platform",
      meta: { capability: input.capability },
    });
    this.name = "ApiAuthUnavailableError";
  }
}

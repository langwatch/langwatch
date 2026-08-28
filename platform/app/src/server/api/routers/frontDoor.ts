/**
 * Process wiring for the `frontDoor.*` tRPC surface (D13, ADR-117 §6).
 *
 * The transport itself is package-owned — `FrontDoorTrpcApi` in
 * `@langwatch/auth-server`, mounted through
 * `@langwatch/platform-api/app-trpc`. What is left here is the composition
 * this application still owns: its tRPC root, its public and authenticated
 * procedures, its authorization middlewares, the throttle, the sign-in
 * router, the sign-up ceremony, and the invitation reads a signed-out visitor
 * meets at the door.
 */
import type { AppTrpcPolicyMiddlewares } from "@langwatch/api/trpc";
import { createFrontDoorTrpcRouter, declaredCheckFrom } from "@langwatch/platform-api/app-trpc";
import type { TRPCContext } from "~/server/api/trpc.context";
import {
  checkDeclaredPermission,
  checkDeclaredPermissionAny,
  declaredNoPermission,
  declaredServiceAuthorization,
} from "~/server/app-layer/authz/trpc-middleware";
import { signInRouter, signUpVerification } from "~/server/app-layer/identity/runtime";
import { InviteExpiredError, InviteNotFoundError } from "~/server/invites/errors";
import { buildMembersSettingsUrl } from "~/server/invites/invite-link";
import { InviteService, resolveInviteDisplayStatus } from "~/server/invites/invite.service";
import { rateLimit } from "~/server/rateLimit";
import { getClientIp } from "~/utils/getClientIp";
import { appTrpcRoot } from "../trpc.root";
import {
  auditLogMutations,
  authProtectedProcedure,
  enforcePermissionCheck,
  handledErrorMiddleware,
  loggerMiddleware,
  tracerMiddleware,
} from "../trpc.runtime-policy";
import { scopeLineageGuard } from "../trpc.scope-lineage-middleware";

/** This process's concrete policy chain, in the order the mount applies it. */
const middlewares: AppTrpcPolicyMiddlewares = {
  tracer: tracerMiddleware,
  logger: loggerMiddleware,
  handledError: handledErrorMiddleware,
  scopeLineageGuard,
  declaredCheck: declaredCheckFrom({
    permission: checkDeclaredPermission,
    permissionAny: checkDeclaredPermissionAny,
    noPermission: declaredNoPermission,
    serviceAuthorized: declaredServiceAuthorization,
  }),
  enforceCheck: enforcePermissionCheck,
  auditMutations: auditLogMutations,
};

/** The sign-up ceremony, composed per request over this process's app. */
const signUp = (ctx: TRPCContext) => signUpVerification(ctx.app.mailer, ctx.app.users);

export const frontDoorRouter = createFrontDoorTrpcRouter({
  root: appTrpcRoot,
  protectedProcedure: authProtectedProcedure,
  publicProcedure: appTrpcRoot.procedure,
  middlewares,
  ports: {
    clientIp: (ctx: TRPCContext) => getClientIp(ctx.req) ?? "unknown",
    rateLimit,
    route: (input) => signInRouter().route(input),
    addressIsRegistered: (ctx: TRPCContext, input) => signUp(ctx).addressIsRegistered(input),
    requestSignUpVerification: (ctx: TRPCContext, input) => signUp(ctx).requestVerification(input),
    completeSignUpVerification: (ctx: TRPCContext, input) =>
      signUp(ctx).completeVerification(input),

    /**
     * A revoked invitation reads exactly like a missing one, the same way
     * `organization.acceptInvite` answers it: the journey ends quietly,
     * revealing nothing about the organization or the inviter. Expired is
     * different — it is recoverable (the inviter resends in one click), so it
     * gets its own named refusal.
     */
    readInviteLanding: async (ctx: TRPCContext, { inviteCode }) => {
      const invite = await ctx.prisma.organizationInvite.findUnique({
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
      if (status === "EXPIRED") {
        throw new InviteExpiredError();
      }

      return {
        organizationName: invite.organization.name,
        inviterName: invite.requestedByUser?.name ?? null,
        alreadyAccepted: status === "ACCEPTED",
      };
    },

    requestFreshInvite: async (ctx: TRPCContext, { inviteCode }) => {
      await InviteService.create(ctx.prisma, { mailer: ctx.app.mailer }).requestFreshInvite({
        inviteCode,
        membersSettingsUrl: buildMembersSettingsUrl(),
      });
    },
  },
});

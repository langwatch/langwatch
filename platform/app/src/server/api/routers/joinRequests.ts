/**
 * Process wiring for the `joinRequests.*` tRPC surface.
 *
 * The transport itself is package-owned — `JoinRequestTrpcApi` in
 * `@langwatch/organization-server`, mounted through
 * `@langwatch/platform-api/app-trpc`. What is left here is the composition
 * this application still owns: its tRPC root, its authenticated procedure,
 * its authorization middlewares, and the join-request service, which this
 * process composes over the identity ledger, the membership writer that
 * emits authorization grants, the organization's join settings and the
 * mailer.
 */
import {
  createJoinRequestTrpcRouter,
  declaredCheckFrom,
  type AppTrpcPolicyMiddlewares,
} from "@langwatch/platform-api/app-trpc";
import type { TRPCContext } from "~/server/api/trpc.context";
import {
  checkDeclaredPermission,
  checkDeclaredPermissionAny,
  declaredNoPermission,
  declaredServiceAuthorization,
} from "~/server/app-layer/authz/trpc-middleware";
import { identityEmail, joinRequestsService } from "~/server/app-layer/identity/runtime";
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

/** The join-request service, composed per request over this process's app. */
function joinRequests(ctx: Pick<TRPCContext, "app">) {
  return joinRequestsService({
    authzGrants: ctx.app.authzGrants,
    featureFlags: ctx.app.featureFlags,
    mailer: ctx.app.mailer,
  });
}

/**
 * The caller's own verified address, and the reason every requester-side
 * procedure starts here.
 *
 * `verifiedEmailsOf` answers `null` for a user who is not on identifiers yet,
 * which is the legacy fallback the rest of the identity surface uses: the
 * `User.email` column, but only where better-auth has marked it verified. An
 * unverified address answers null, and every caller treats that as the
 * universal nothing.
 */
async function verifiedEmailFor(
  ctx: Pick<TRPCContext, "prisma">,
  { userId }: { userId: string },
): Promise<string | null> {
  const verified = await identityEmail().verifiedEmailsOf({ userId });
  if (verified !== null) return verified[0]?.value ?? null;

  const row = await ctx.prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, emailVerified: true },
  });
  return row?.emailVerified ? (row.email ?? null) : null;
}

export const joinRequestsRouter = createJoinRequestTrpcRouter({
  root: appTrpcRoot,
  protectedProcedure: authProtectedProcedure,
  middlewares,
  ports: {
    lookup: (ctx: TRPCContext, input) => joinRequests(ctx).lookup(input),
    pendingForUser: (ctx: TRPCContext, input) => joinRequests(ctx).pendingForUser(input),
    request: (ctx: TRPCContext, input) => joinRequests(ctx).request(input),
    withdraw: (ctx: TRPCContext, input) => joinRequests(ctx).withdraw(input),
    pendingForOrganization: (ctx: TRPCContext, input) =>
      joinRequests(ctx).pendingForOrganization(input),
    approve: (ctx: TRPCContext, input) => joinRequests(ctx).approve(input),
    reject: (ctx: TRPCContext, input) => joinRequests(ctx).reject(input),
    readJoining: (ctx: TRPCContext, input) => joinRequests(ctx).readJoining(input),
    setJoining: (ctx: TRPCContext, input) => joinRequests(ctx).setJoining(input),
    tryResolveVerifiedEmail: verifiedEmailFor,
    listUserNames: (ctx: TRPCContext, { userIds }) =>
      ctx.prisma.user.findMany({
        where: { id: { in: [...userIds] } },
        select: { id: true, name: true },
      }),
  },
});

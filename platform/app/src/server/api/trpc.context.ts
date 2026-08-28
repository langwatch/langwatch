import type { OrganizationUserRole } from "~/generated/prisma/client";
import { type AuthzPermission, ProjectPermissionDeniedError } from "@langwatch/authz-contract";
import { TRPCError } from "@trpc/server";
import type { RequestAppServices } from "~/runtime/app/requestApp";
import { getApp } from "~/server/app-layer/app";
import type { Session } from "~/server/auth";
import { getServerAuthSession } from "~/server/auth";
import { prisma } from "~/server/db";
import type { NextApiRequest, NextApiResponse } from "~/types/next-stubs";
import type { OpsScope } from "./rbac";

export interface CreateNextTrpcContextOptions {
  req: NextApiRequest;
  res: NextApiResponse;
  app: RequestAppServices;
}

export interface CreateTrpcContextOptions {
  req?: NextApiRequest;
  res?: NextApiResponse;
  session: Session | null;
  /**
   * The explicit request application. The fallback below exists only for the
   * retained Next/SSG compatibility callers that cannot inject it yet.
   */
  app?: RequestAppServices;
  permissionChecked?: boolean;
  publiclyShared?: boolean;
  organizationRole?: OrganizationUserRole | null;
  opsScope?: OpsScope;
  signal?: AbortSignal;
}

export interface TRPCContext {
  session: Session | null;
  req: NextApiRequest | undefined;
  res: NextApiResponse | undefined;
  prisma: typeof prisma;
  app: RequestAppServices;
  permissionChecked: boolean;
  publiclyShared: boolean;
  organizationRole: OrganizationUserRole | undefined;
  opsScope: OpsScope | undefined;
  signal: AbortSignal | undefined;
  actor(): Readonly<{ id: string }>;
  authorize(permission: AuthzPermission, target: Readonly<{ projectId: string }>): Promise<void>;
  can(permission: AuthzPermission, target: Readonly<{ projectId: string }>): Promise<boolean>;
}

/**
 * Compatibility residual for legacy Next handlers and SSG helpers. Running
 * Hono/tRPC composition injects the process-owned app explicitly.
 */
function createLegacyRequestApp(): RequestAppServices {
  return getApp();
}

export function createInnerTRPCContext(opts: CreateTrpcContextOptions): TRPCContext {
  const app = opts.app ?? createLegacyRequestApp();
  const actor = () => {
    const user = opts.session?.user;
    if (!user) throw new TRPCError({ code: "UNAUTHORIZED" });
    return { id: user.id };
  };
  const can = async (permission: AuthzPermission, target: Readonly<{ projectId: string }>) => {
    const user = actor();
    const decision = await app.permissions.getDecision({
      userId: user.id,
      permission,
      scope: { tier: "project", id: target.projectId },
    });
    return decision.permitted;
  };

  return {
    session: opts.session,
    req: opts.req,
    res: opts.res,
    prisma,
    app,
    permissionChecked: opts.permissionChecked ?? false,
    publiclyShared: opts.publiclyShared ?? false,
    organizationRole: opts.organizationRole ?? undefined,
    opsScope: opts.opsScope,
    signal: opts.signal,
    actor,
    can,
    authorize: async (permission, target) => {
      if (await can(permission, target)) return;
      throw new TRPCError({
        code: "FORBIDDEN",
        cause: new ProjectPermissionDeniedError(permission),
      });
    },
  };
}

export async function createTRPCContext(opts: CreateNextTrpcContextOptions): Promise<TRPCContext> {
  const session = await getServerAuthSession({ app: opts.app, req: opts.req, res: opts.res });

  return createInnerTRPCContext({
    req: opts.req,
    res: opts.res,
    session,
    app: opts.app,
    permissionChecked: false,
    publiclyShared: false,
  });
}

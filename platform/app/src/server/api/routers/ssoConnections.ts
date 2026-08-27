import { HandledError } from "@langwatch/handled-error";
import type { OpsService } from "@langwatch/ops-contract";
import { z } from "zod";
import { auditLog } from "~/runtime/app/features/audit-log";
import { ssoConnections } from "~/server/app-layer/identity/runtime";
import { SsoConnectionBackofficeService } from "~/server/app-layer/identity/sso-connection-backoffice.service";
import { prisma } from "~/server/db";
import { createTRPCRouter, protectedProcedure } from "../trpc";

/**
 * The back office's SSO connection surface (D05 tier 1).
 *
 * tRPC rather than the flat REST admin API for one reason: every change to a
 * connection is a GUARDED COMMAND with the operator recorded on it, and the
 * REST surface is `ra-data-simple-prisma` writing table rows. There is no
 * shape of that surface which could carry a lifecycle verb, and a raw row
 * write here would be overwritten by the next fold anyway. `BugReportsView`
 * is the precedent for a back-office resource on tRPC; this is the first one
 * that also writes.
 *
 * Gating is the back office's existing gating, unchanged: `ADMIN_EMAILS` plus
 * an in-handler `isAdmin`, deliberately NOT `ops:*`. `ops` is the registry's
 * only platform-scope resource and never reaches the tRPC `.permission()`
 * surface at all; more to the point, if `ops` ever widens to a broader
 * operator population, who may attest a customer's domain must not widen with
 * it by accident. So every procedure declares `.noPermission()` with that
 * reason and checks the admin list itself.
 *
 * Denial is a 404 built from `AdminSurfaceHiddenError` — byte-identical to an
 * unregistered path, so the surface does not confirm its own existence to a
 * prober. That is why this file throws the shared error rather than a
 * `TRPCError({ code: "FORBIDDEN" })`.
 *
 * The guards underneath refuse a second time, and differently: the admin list
 * decides who reaches the surface, and the platform-operator port decides
 * whose hand may approve a claim or attest a domain. Both are the same list
 * today. They are two checks because they answer two questions, and the
 * second one holds for callers that never came through here.
 */

const NO_PERMISSION = {
  reason:
    "back-office surface gated on the ADMIN_EMAILS staff list, not on an RBAC permission; cross-tenant by design",
} as const;

/**
 * The same opt-out for the verbs whose input names an organization.
 *
 * The justification the declaration demands is the important half: the id is
 * NOT what decides the caller's reach here. An operator who is on the staff
 * list may act on any organization, and one who is not may act on none — so
 * `organizationId` is routing, saying which tenant's history the command is
 * appended to, and it is never read as a scope the caller was granted.
 */
const NO_PERMISSION_FOR_ORGANIZATION = {
  ...NO_PERMISSION,
  allow: {
    organizationId:
      "names the tenant whose connection history the command appends to; the caller's reach is the ADMIN_EMAILS staff list and is never derived from this id",
  },
} as const;

/** The operator, or a 404 that says nothing about why. */
class AdminSurfaceHiddenError extends HandledError {
  declare readonly code: "not_found";

  constructor() {
    super("not_found", "Not found", { httpStatus: 404, fault: "customer" });
    this.name = "AdminSurfaceHiddenError";
  }
}

function requireOperator({
  ops,
  user,
}: {
  ops: OpsService;
  user: { id: string; email?: string | null };
}): {
  userId: string;
} {
  if (!ops.isAdmin(user)) throw new AdminSurfaceHiddenError();
  return { userId: user.id };
}

function service(): SsoConnectionBackofficeService {
  return new SsoConnectionBackofficeService({
    prisma,
    connections: ssoConnections,
  });
}

const connectionTarget = z.object({
  organizationId: z.string().min(1),
  connectionId: z.string().min(1),
});

const domainTarget = connectionTarget.extend({
  domain: z.string().min(1).max(253),
});

export const ssoConnectionsRouter = createTRPCRouter({
  getAll: protectedProcedure
    .input(
      z.object({
        page: z.number().int().min(0).default(0),
        pageSize: z.number().int().min(1).max(100).default(25),
        search: z.string().max(253).optional(),
      }),
    )
    .noPermission(NO_PERMISSION)
    .query(async ({ ctx, input }) => {
      const user = ctx.session.user.impersonator ?? ctx.session.user;
      const operator = requireOperator({ ops: ctx.app.ops, user });
      await auditLog({
        userId: operator.userId,
        action: "ssoConnections.getAll",
        args: {
          page: input.page,
          pageSize: input.pageSize,
          hasSearch: Boolean(input.search),
        },
        targetKind: "ssoConnection",
      });
      return service().list(input);
    }),

  getById: protectedProcedure
    .input(z.object({ connectionId: z.string().min(1) }))
    .noPermission(NO_PERMISSION)
    .query(async ({ ctx, input }) => {
      const user = ctx.session.user.impersonator ?? ctx.session.user;
      const operator = requireOperator({ ops: ctx.app.ops, user });
      await auditLog({
        userId: operator.userId,
        action: "ssoConnections.getById",
        args: { connectionId: input.connectionId },
        targetKind: "ssoConnection",
        targetId: input.connectionId,
      });
      return service().getById(input);
    }),

  register: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        // The union the aggregate speaks, so a SAML request reaches the
        // service and is refused BY NAME. Narrowing it to `"oidc"` here would
        // answer a validation error instead, which tells the operator the
        // field is wrong rather than that the protocol is not self-serve yet.
        type: z.enum(["oidc", "saml"]),
        providerId: z.string().min(1).max(100),
        issuer: z.string().max(2048).nullable().default(null),
        allowsJit: z.boolean().default(false),
      }),
    )
    .noPermission(NO_PERMISSION_FOR_ORGANIZATION)
    .mutation(async ({ ctx, input }) => {
      const operator = await audited({ ctx, action: "register", args: input });
      return service().registerConnection({ ...input, operator });
    }),

  claimDomain: protectedProcedure
    .input(domainTarget)
    .noPermission(NO_PERMISSION_FOR_ORGANIZATION)
    .mutation(async ({ ctx, input }) => {
      const operator = await audited({
        ctx,
        action: "claimDomain",
        args: input,
      });
      await service().claimDomain({ ...input, operator });
    }),

  approveDomainClaim: protectedProcedure
    .input(domainTarget)
    .noPermission(NO_PERMISSION_FOR_ORGANIZATION)
    .mutation(async ({ ctx, input }) => {
      const operator = await audited({
        ctx,
        action: "approveDomainClaim",
        args: input,
      });
      await service().approveDomainClaim({ ...input, operator });
    }),

  rejectDomainClaim: protectedProcedure
    .input(domainTarget.extend({ note: z.string().min(1).max(1000) }))
    .noPermission(NO_PERMISSION_FOR_ORGANIZATION)
    .mutation(async ({ ctx, input }) => {
      const operator = await audited({
        ctx,
        action: "rejectDomainClaim",
        args: { ...input, note: undefined },
      });
      await service().rejectDomainClaim({ ...input, operator });
    }),

  attestDomain: protectedProcedure
    .input(domainTarget)
    .noPermission(NO_PERMISSION_FOR_ORGANIZATION)
    .mutation(async ({ ctx, input }) => {
      const operator = await audited({
        ctx,
        action: "attestDomain",
        args: input,
      });
      await service().attestDomain({ ...input, operator });
    }),

  activate: protectedProcedure
    .input(connectionTarget.extend({ testLoginAccountId: z.string().min(1) }))
    .noPermission(NO_PERMISSION_FOR_ORGANIZATION)
    .mutation(async ({ ctx, input }) => {
      const operator = await audited({ ctx, action: "activate", args: input });
      await service().activateConnection({ ...input, operator });
    }),

  suspend: protectedProcedure
    .input(
      connectionTarget.extend({
        reason: z.string().min(1).max(1000).nullable().default(null),
      }),
    )
    .noPermission(NO_PERMISSION_FOR_ORGANIZATION)
    .mutation(async ({ ctx, input }) => {
      const operator = await audited({ ctx, action: "suspend", args: input });
      await service().suspendConnection({ ...input, operator });
    }),

  resume: protectedProcedure
    .input(connectionTarget)
    .noPermission(NO_PERMISSION_FOR_ORGANIZATION)
    .mutation(async ({ ctx, input }) => {
      const operator = await audited({ ctx, action: "resume", args: input });
      await service().resumeConnection({ ...input, operator });
    }),

  requestTeardown: protectedProcedure
    .input(
      connectionTarget.extend({
        reason: z.string().min(1).max(1000).nullable().default(null),
      }),
    )
    .noPermission(NO_PERMISSION_FOR_ORGANIZATION)
    .mutation(async ({ ctx, input }) => {
      const operator = await audited({
        ctx,
        action: "requestTeardown",
        args: input,
      });
      await service().requestTeardown({
        ...input,
        operator,
        graceMs: TEARDOWN_GRACE_MS,
      });
    }),
});

/**
 * How long a removal stays reversible before the process manager completes
 * it. Seven days: long enough that a mistaken teardown is noticed by somebody
 * signing in on a Monday, short enough that a connection nobody wants does
 * not linger routing.
 */
const TEARDOWN_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Gate and record in one move. Every mutation on this surface is cross-tenant
 * and every one of them changes how somebody signs in, so the audit row is
 * written BEFORE the command — an operator asking "why did this happen at
 * 03:14" needs the attempt, not only the successes.
 */
async function audited({
  ctx,
  action,
  args,
}: {
  ctx: {
    app: { ops: OpsService };
    session: {
      user: {
        id: string;
        email?: string | null;
        impersonator?: { id: string; email?: string | null } | null;
      };
    };
  };
  action: string;
  args: Record<string, unknown>;
}): Promise<{ userId: string }> {
  const user = ctx.session.user.impersonator ?? ctx.session.user;
  const operator = requireOperator({ ops: ctx.app.ops, user });
  await auditLog({
    userId: operator.userId,
    action: `ssoConnections.${action}`,
    args,
    targetKind: "ssoConnection",
    targetId: typeof args.connectionId === "string" ? args.connectionId : undefined,
  });
  return operator;
}

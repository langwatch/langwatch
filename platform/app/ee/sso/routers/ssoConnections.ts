import { adminSurfaceHidden } from "@ee/admin/adminSurfaceHidden";
import { isAdmin as checkIsAdmin } from "@ee/admin/isAdmin";
import { auditLog } from "@ee/audit-log/auditLog";
import { ssoIdpRegistrationSchema } from "@ee/sso/sso-idp-registration";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import {
  ssoConnectionBackoffice,
  ssoSelfServe,
} from "~/server/app-layer/identity/runtime";

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
function requireOperator(user: { id: string; email?: string | null }): {
  userId: string;
} {
  if (!checkIsAdmin(user)) throw adminSurfaceHidden();
  return { userId: user.id };
}

const connectionTarget = z.object({
  organizationId: z.string().min(1),
  connectionId: z.string().min(1),
});

const domainTarget = connectionTarget.extend({
  domain: z.string().min(1).max(253),
});

const migrationProgressInput = z.object({
  connectionId: z.string().min(1),
  cursor: z.string().nullable().default(null),
  limit: z.number().int().min(1).max(100).default(50),
});

const legacyMigrationInput = z.object({
  organizationId: z.string().min(1),
  legacyConnectionId: z.string().min(1),
  providerId: z.string().min(1).max(100),
  idp: ssoIdpRegistrationSchema,
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
      const operator = requireOperator(user);
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
      return ssoConnectionBackoffice().list(input);
    }),

  getById: protectedProcedure
    .input(z.object({ connectionId: z.string().min(1) }))
    .noPermission(NO_PERMISSION)
    .query(async ({ ctx, input }) => {
      const user = ctx.session.user.impersonator ?? ctx.session.user;
      const operator = requireOperator(user);
      await auditLog({
        userId: operator.userId,
        action: "ssoConnections.getById",
        args: { connectionId: input.connectionId },
        targetKind: "ssoConnection",
        targetId: input.connectionId,
      });
      return ssoConnectionBackoffice().getById(input);
    }),

  /**
   * The connection's raw event history (ADR-117 SS5, D04), read the same way
   * the organization's own authentication page reads it — same words, same
   * events. Answers null for a connection that does not exist, exactly as
   * `getById` does.
   */
  getHistory: protectedProcedure
    .input(z.object({ connectionId: z.string().min(1) }))
    .noPermission(NO_PERMISSION)
    .query(async ({ ctx, input }) => {
      const user = ctx.session.user.impersonator ?? ctx.session.user;
      const operator = requireOperator(user);
      await auditLog({
        userId: operator.userId,
        action: "ssoConnections.getHistory",
        args: { connectionId: input.connectionId },
        targetKind: "ssoConnection",
        targetId: input.connectionId,
      });
      return ssoConnectionBackoffice().getHistory(input);
    }),

  /**
   * Migration inventory uses the same progress evidence as organization
   * settings. The staff gate and audit happen before resolving the connection
   * or reading tenant-scoped migration data.
   */
  getMigrationProgress: protectedProcedure
    .input(migrationProgressInput)
    .noPermission(NO_PERMISSION)
    .query(async ({ ctx, input }) => {
      await audited({
        ctx,
        action: "getMigrationProgress",
        args: { connectionId: input.connectionId },
      });
      const connection = await ssoConnectionBackoffice().getById({
        connectionId: input.connectionId,
      });
      if (!connection) return null;
      return ssoSelfServe().getMigrationProgress({
        organizationId: connection.organizationId,
        connectionId: input.connectionId,
        cursor: input.cursor,
        limit: input.limit,
      });
    }),

  /**
   * Import the customer's supplied provider configuration into an explicit
   * replacement. The shared self-serve service validates and seals the
   * credentials before appending the registration command.
   */
  startLegacyMigration: protectedProcedure
    .input(legacyMigrationInput)
    .noPermission(NO_PERMISSION_FOR_ORGANIZATION)
    .mutation(async ({ ctx, input }) => {
      const actor = await audited({
        ctx,
        action: "startLegacyMigration",
        args: {
          organizationId: input.organizationId,
          connectionId: input.legacyConnectionId,
          providerId: input.providerId,
          protocol: input.idp.protocol,
        },
      });
      const connection = await ssoConnectionBackoffice().getById({
        connectionId: input.legacyConnectionId,
      });
      if (!connection || connection.organizationId !== input.organizationId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return ssoSelfServe().startLegacyMigration({
        organizationId: connection.organizationId,
        legacyConnectionId: connection.connectionId,
        providerId: input.providerId,
        idp: input.idp,
        actor,
      });
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
      await ssoConnectionBackoffice().approveDomainClaim({
        ...input,
        operator,
      });
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
      await ssoConnectionBackoffice().rejectDomainClaim({ ...input, operator });
    }),

  attestDomain: protectedProcedure
    .input(
      domainTarget.extend({
        evidenceRef: z.string().trim().min(1).max(500),
        note: z.string().trim().min(1).max(1_000),
      }),
    )
    .noPermission(NO_PERMISSION_FOR_ORGANIZATION)
    .mutation(async ({ ctx, input }) => {
      const operator = await audited({
        ctx,
        action: "attestDomain",
        args: { ...input, note: undefined },
      });
      await ssoConnectionBackoffice().attestDomain({ ...input, operator });
    }),

  activate: protectedProcedure
    .input(connectionTarget.extend({ testLoginAccountId: z.string().min(1) }))
    .noPermission(NO_PERMISSION_FOR_ORGANIZATION)
    .mutation(async ({ ctx, input }) => {
      const operator = await audited({ ctx, action: "activate", args: input });
      await ssoConnectionBackoffice().activateConnection({
        ...input,
        operator,
      });
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
      await ssoConnectionBackoffice().suspendConnection({ ...input, operator });
    }),

  resume: protectedProcedure
    .input(connectionTarget)
    .noPermission(NO_PERMISSION_FOR_ORGANIZATION)
    .mutation(async ({ ctx, input }) => {
      const operator = await audited({ ctx, action: "resume", args: input });
      await ssoConnectionBackoffice().resumeConnection({ ...input, operator });
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
      await ssoConnectionBackoffice().requestTeardown({
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
  const operator = requireOperator(user);
  await auditLog({
    userId: operator.userId,
    action: `ssoConnections.${action}`,
    args,
    targetKind: "ssoConnection",
    targetId:
      typeof args.connectionId === "string" ? args.connectionId : undefined,
  });
  return operator;
}

import { auditLog } from "@ee/audit-log/auditLog";
import { z } from "zod";
import { prisma } from "~/server/db";
import { adminSurfaceHidden } from "../../../../ee/admin/adminSurfaceHidden";
import { isAdmin as checkIsAdmin } from "../../../../ee/admin/isAdmin";
import { createLicenseRegistryService } from "../../../../ee/licensing/registry/composition";
import { CONNECT_SERVICES } from "../../../../ee/licensing/registry/licenseRegistry.service";
import { createTRPCRouter, protectedProcedure } from "../trpc";

/**
 * The backoffice's license registry surface (ADR-139).
 *
 * tRPC rather than the flat REST admin API because every change here is a verb
 * (issue, revoke, reissue, reset the instance binding) and that surface can only
 * write table rows.
 *
 * Gating is the backoffice's: the `ADMIN_EMAILS` staff list checked in the
 * handler, never an RBAC permission. An organization admin has no business
 * issuing LangWatch licenses, whatever they may do inside their organization.
 * Denial is the shared 404, identical to an unregistered path.
 *
 * A license key is credential material: a connected install derives its token
 * from it. So no audit entry here records one, only that one was supplied.
 */

const NO_PERMISSION = {
  reason:
    "back-office surface gated on the ADMIN_EMAILS staff list, not on an RBAC permission; cross-tenant by design",
} as const;

const NO_PERMISSION_FOR_ORGANIZATION = {
  ...NO_PERMISSION,
  allow: {
    organizationId:
      "names the customer organization a license is linked to; the caller's reach is the ADMIN_EMAILS staff list and is never derived from this id",
  },
} as const;

/** The operator, or a 404 that says nothing about why. */
function requireOperator(user: { id: string; email?: string | null }): {
  userId: string;
} {
  if (!checkIsAdmin(user)) throw adminSurfaceHidden();
  return { userId: user.id };
}

const service = () => createLicenseRegistryService(prisma);

const licenseTarget = z.object({ id: z.string().min(1) });

const termsInput = z.object({
  services: z.array(z.enum(CONNECT_SERVICES)).optional(),
  seatOverageAllowance: z.number().int().min(0).nullable().optional(),
  seatRateCents: z.number().int().min(0).nullable().optional(),
  seatCurrency: z.enum(["USD", "EUR"]).nullable().optional(),
  commitUsdCents: z.number().int().min(0).optional(),
  overageEnabled: z.boolean().optional(),
  overageMaxUsdCents: z.number().int().min(0).nullable().optional(),
});

const seatLimits = {
  maxMembers: z.number().int().positive(),
  maxMembersLite: z.number().int().min(0).optional(),
  maxMessagesPerMonth: z.number().int().positive().optional(),
};

export const licenseRegistryRouter = createTRPCRouter({
  getAll: protectedProcedure
    .input(
      z.object({
        page: z.number().int().min(0).default(0),
        pageSize: z.number().int().min(1).max(100).default(25),
        search: z.string().max(200).optional(),
      }),
    )
    .noPermission(NO_PERMISSION)
    .query(async ({ ctx, input }) => {
      const operator = requireOperator(
        ctx.session.user.impersonator ?? ctx.session.user,
      );
      await auditLog({
        userId: operator.userId,
        action: "licenseRegistry.getAll",
        args: {
          page: input.page,
          pageSize: input.pageSize,
          hasSearch: Boolean(input.search),
        },
        targetKind: "issuedLicense",
      });
      return service().getAll(input);
    }),

  getById: protectedProcedure
    .input(licenseTarget)
    .noPermission(NO_PERMISSION)
    .query(async ({ ctx, input }) => {
      const operator = requireOperator(
        ctx.session.user.impersonator ?? ctx.session.user,
      );
      await auditLog({
        userId: operator.userId,
        action: "licenseRegistry.getById",
        args: { id: input.id },
        targetKind: "issuedLicense",
        targetId: input.id,
      });
      return service().getById(input);
    }),

  /**
   * Signs a license with the server's key and records it. The signed license is
   * returned once, to be handed to the customer.
   */
  issue: protectedProcedure
    .input(
      z.object({
        customer: z.union([
          z.object({ organizationId: z.string().min(1) }),
          z.object({ newOrganizationName: z.string().trim().min(1).max(200) }),
        ]),
        email: z.string().email(),
        planType: z.enum(["GROWTH", "PRO", "ENTERPRISE", "CUSTOM"]),
        ...seatLimits,
        expiresAt: z.date(),
        terms: termsInput.optional(),
      }),
    )
    .noPermission(NO_PERMISSION)
    .mutation(async ({ ctx, input }) => {
      const operator = requireOperator(
        ctx.session.user.impersonator ?? ctx.session.user,
      );
      const result = await service().issue({
        ...input,
        operatorId: operator.userId,
      });
      await auditLog({
        userId: operator.userId,
        action: "licenseRegistry.issue",
        args: {
          organizationId: result.license.organizationId,
          planType: input.planType,
          maxMembers: input.maxMembers,
          expiresAt: input.expiresAt.toISOString(),
        },
        targetKind: "issuedLicense",
        targetId: result.license.id,
      });
      return result;
    }),

  registerLegacy: protectedProcedure
    .input(
      z.object({
        licenseKey: z.string().min(1).max(20_000),
        organizationId: z.string().min(1),
      }),
    )
    .noPermission(NO_PERMISSION_FOR_ORGANIZATION)
    .mutation(async ({ ctx, input }) => {
      const operator = requireOperator(
        ctx.session.user.impersonator ?? ctx.session.user,
      );
      const license = await service().registerLegacy({
        ...input,
        operatorId: operator.userId,
      });
      await auditLog({
        userId: operator.userId,
        action: "licenseRegistry.registerLegacy",
        args: { organizationId: input.organizationId },
        targetKind: "issuedLicense",
        targetId: license.id,
      });
      return license;
    }),

  revoke: protectedProcedure
    .input(licenseTarget.extend({ reason: z.string().trim().min(3).max(500) }))
    .noPermission(NO_PERMISSION)
    .mutation(async ({ ctx, input }) => {
      const operator = requireOperator(
        ctx.session.user.impersonator ?? ctx.session.user,
      );
      const license = await service().revoke({
        ...input,
        operatorId: operator.userId,
      });
      await auditLog({
        userId: operator.userId,
        action: "licenseRegistry.revoke",
        args: { id: input.id, reason: input.reason },
        targetKind: "issuedLicense",
        targetId: input.id,
      });
      return license;
    }),

  /** Signs a replacement. The new signed license is returned once. */
  reissue: protectedProcedure
    .input(
      licenseTarget.extend({
        maxMembers: seatLimits.maxMembers.optional(),
        maxMembersLite: seatLimits.maxMembersLite,
        maxMessagesPerMonth: seatLimits.maxMessagesPerMonth,
        expiresAt: z.date(),
      }),
    )
    .noPermission(NO_PERMISSION)
    .mutation(async ({ ctx, input }) => {
      const operator = requireOperator(
        ctx.session.user.impersonator ?? ctx.session.user,
      );
      const result = await service().reissue({
        ...input,
        operatorId: operator.userId,
      });
      await auditLog({
        userId: operator.userId,
        action: "licenseRegistry.reissue",
        args: {
          replaces: input.id,
          maxMembers: result.license.maxMembers,
          expiresAt: input.expiresAt.toISOString(),
        },
        targetKind: "issuedLicense",
        targetId: result.license.id,
      });
      return result;
    }),

  resetInstanceBinding: protectedProcedure
    .input(licenseTarget)
    .noPermission(NO_PERMISSION)
    .mutation(async ({ ctx, input }) => {
      const operator = requireOperator(
        ctx.session.user.impersonator ?? ctx.session.user,
      );
      const license = await service().resetInstanceBinding(input);
      await auditLog({
        userId: operator.userId,
        action: "licenseRegistry.resetInstanceBinding",
        args: { id: input.id },
        targetKind: "issuedLicense",
        targetId: input.id,
      });
      return license;
    }),

  updateTerms: protectedProcedure
    .input(licenseTarget.merge(termsInput))
    .noPermission(NO_PERMISSION)
    .mutation(async ({ ctx, input }) => {
      const operator = requireOperator(
        ctx.session.user.impersonator ?? ctx.session.user,
      );
      const license = await service().updateTerms({
        ...input,
        operatorId: operator.userId,
      });
      const { id, ...terms } = input;
      await auditLog({
        userId: operator.userId,
        action: "licenseRegistry.updateTerms",
        args: { id, ...terms },
        targetKind: "issuedLicense",
        targetId: id,
      });
      return license;
    }),

  linkToOrganization: protectedProcedure
    .input(licenseTarget.extend({ organizationId: z.string().min(1) }))
    .noPermission(NO_PERMISSION_FOR_ORGANIZATION)
    .mutation(async ({ ctx, input }) => {
      const operator = requireOperator(
        ctx.session.user.impersonator ?? ctx.session.user,
      );
      const license = await service().linkToOrganization({
        ...input,
        operatorId: operator.userId,
      });
      await auditLog({
        userId: operator.userId,
        action: "licenseRegistry.linkToOrganization",
        args: { id: input.id, organizationId: input.organizationId },
        targetKind: "issuedLicense",
        targetId: input.id,
      });
      return license;
    }),
});

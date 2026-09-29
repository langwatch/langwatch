import { auditLog } from "@ee/audit-log/auditLog";
import { z } from "zod";
import { prisma } from "~/server/db";
import { adminSurfaceHidden } from "../../../../ee/admin/adminSurfaceHidden";
import { isAdmin as checkIsAdmin } from "../../../../ee/admin/isAdmin";
import { CONNECT_SERVICES } from "../../../../ee/licensing/connect/services";
import {
  createActivationCodeService,
  createLicenseRegistryService,
} from "../../../../ee/licensing/registry/composition";
import { createTRPCRouter, protectedProcedure } from "../trpc";

/**
 * The backoffice's license registry surface (ADR-141).
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

/**
 * Runs a license-registry command and, when the service refuses it, records the
 * attempt before the refusal travels on. A refusal is the half of the trail an
 * operator most often needs back: the successful audit entry below can name
 * what the command produced, this one can only name what was asked for.
 */
async function audited<T>({
  operatorId,
  action,
  args,
  targetId,
  run,
}: {
  operatorId: string;
  action: string;
  args: Record<string, unknown>;
  targetId?: string;
  run: () => Promise<T>;
}): Promise<T> {
  try {
    return await run();
  } catch (error) {
    await auditLog({
      userId: operatorId,
      action,
      args,
      error: error instanceof Error ? error : new Error(String(error)),
      targetKind: "issuedLicense",
      ...(targetId === undefined ? {} : { targetId }),
    });
    throw error;
  }
}

const service = () => createLicenseRegistryService(prisma);
const activationCodes = () => createActivationCodeService(prisma);

const licenseTarget = z.object({ id: z.string().min(1) });

const termsInput = z.object({
  services: z.array(z.enum(CONNECT_SERVICES)).optional(),
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
      const result = await audited({
        operatorId: operator.userId,
        action: "licenseRegistry.issue",
        args: {
          planType: input.planType,
          maxMembers: input.maxMembers,
          expiresAt: input.expiresAt.toISOString(),
        },
        run: () => service().issue({ ...input, operatorId: operator.userId }),
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
      const license = await audited({
        operatorId: operator.userId,
        action: "licenseRegistry.registerLegacy",
        args: { organizationId: input.organizationId },
        run: () =>
          service().registerLegacy({ ...input, operatorId: operator.userId }),
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
      const license = await audited({
        operatorId: operator.userId,
        action: "licenseRegistry.revoke",
        args: { id: input.id, reason: input.reason },
        targetId: input.id,
        run: () => service().revoke({ ...input, operatorId: operator.userId }),
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
      const result = await audited({
        operatorId: operator.userId,
        action: "licenseRegistry.reissue",
        args: { replaces: input.id, expiresAt: input.expiresAt.toISOString() },
        targetId: input.id,
        run: () => service().reissue({ ...input, operatorId: operator.userId }),
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

  /**
   * Changes the seats of a running license. The replacement is signed for the
   * same term and delivered over sync; seats that went up are invoiced
   * prorated to the end of the term.
   */
  changeSeats: protectedProcedure
    .input(licenseTarget.extend({ maxMembers: seatLimits.maxMembers }))
    .noPermission(NO_PERMISSION)
    .mutation(async ({ ctx, input }) => {
      const operator = requireOperator(
        ctx.session.user.impersonator ?? ctx.session.user,
      );
      const result = await audited({
        operatorId: operator.userId,
        action: "licenseRegistry.changeSeats",
        args: { replaces: input.id, maxMembers: input.maxMembers },
        targetId: input.id,
        run: () =>
          service().changeSeats({ ...input, operatorId: operator.userId }),
      });
      await auditLog({
        userId: operator.userId,
        action: "licenseRegistry.changeSeats",
        args: {
          replaces: input.id,
          previousMaxMembers: result.previousMaxMembers,
          maxMembers: result.license.maxMembers,
          billing: result.billing,
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
      const license = await audited({
        operatorId: operator.userId,
        action: "licenseRegistry.resetInstanceBinding",
        args: { id: input.id },
        targetId: input.id,
        run: () => service().resetInstanceBinding(input),
      });
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
      const license = await audited({
        operatorId: operator.userId,
        action: "licenseRegistry.updateTerms",
        args: { id: input.id },
        targetId: input.id,
        run: () =>
          service().updateTerms({ ...input, operatorId: operator.userId }),
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

  /**
   * Activation codes, issued from the same screen as licenses because they are
   * the same commercial act: a code is a license the customer has not fetched
   * yet. The code itself is returned exactly once, at issue.
   */
  activationCodes: protectedProcedure
    .input(
      z.object({
        page: z.number().int().min(0).default(0),
        pageSize: z.number().int().min(1).max(100).default(25),
        organizationId: z.string().min(1).optional(),
      }),
    )
    .noPermission(NO_PERMISSION_FOR_ORGANIZATION)
    .query(async ({ ctx, input }) => {
      const operator = requireOperator(
        ctx.session.user.impersonator ?? ctx.session.user,
      );
      await auditLog({
        userId: operator.userId,
        action: "licenseRegistry.activationCodes",
        args: { page: input.page, pageSize: input.pageSize },
        targetKind: "activationCode",
      });
      return activationCodes().getAll(input);
    }),

  issueActivationCode: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        organizationName: z.string().trim().min(1).max(200),
        email: z.string().email(),
        planType: z.enum(["GROWTH", "PRO", "ENTERPRISE", "CUSTOM"]),
        maxMembers: seatLimits.maxMembers,
        maxMembersLite: seatLimits.maxMembersLite,
        /** The term of the license the code mints, not the life of the code. */
        licenseTermDays: z.number().int().min(1).max(3650),
        services: z.array(z.enum(CONNECT_SERVICES)).optional(),
        expiresAt: z.date(),
        reusable: z.boolean().optional(),
      }),
    )
    .noPermission(NO_PERMISSION_FOR_ORGANIZATION)
    .mutation(async ({ ctx, input }) => {
      const operator = requireOperator(
        ctx.session.user.impersonator ?? ctx.session.user,
      );
      const result = await audited({
        operatorId: operator.userId,
        action: "licenseRegistry.issueActivationCode",
        args: {
          organizationId: input.organizationId,
          planType: input.planType,
          reusable: input.reusable ?? false,
        },
        run: () =>
          activationCodes().issue({
            ...input,
            ...(input.services ? { services: [...input.services] } : {}),
            operatorId: operator.userId,
          }),
      });
      // The code itself is never recorded: the audit trail says one was issued,
      // to whom and by whom, which is what an operator needs back. The code is
      // credential material and is shown once, here, and never read again.
      await auditLog({
        userId: operator.userId,
        action: "licenseRegistry.issueActivationCode",
        args: {
          organizationId: input.organizationId,
          planType: input.planType,
          expiresAt: input.expiresAt.toISOString(),
        },
        targetKind: "activationCode",
        targetId: result.row.id,
      });
      return result;
    }),

  revokeActivationCode: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .noPermission(NO_PERMISSION)
    .mutation(async ({ ctx, input }) => {
      const operator = requireOperator(
        ctx.session.user.impersonator ?? ctx.session.user,
      );
      const row = await audited({
        operatorId: operator.userId,
        action: "licenseRegistry.revokeActivationCode",
        args: { id: input.id },
        targetId: input.id,
        run: () =>
          activationCodes().revoke({
            id: input.id,
            operatorId: operator.userId,
          }),
      });
      await auditLog({
        userId: operator.userId,
        action: "licenseRegistry.revokeActivationCode",
        args: { id: input.id },
        targetKind: "activationCode",
        targetId: input.id,
      });
      return row;
    }),

  linkToOrganization: protectedProcedure
    .input(licenseTarget.extend({ organizationId: z.string().min(1) }))
    .noPermission(NO_PERMISSION_FOR_ORGANIZATION)
    .mutation(async ({ ctx, input }) => {
      const operator = requireOperator(
        ctx.session.user.impersonator ?? ctx.session.user,
      );
      const license = await audited({
        operatorId: operator.userId,
        action: "licenseRegistry.linkToOrganization",
        args: { id: input.id, organizationId: input.organizationId },
        targetId: input.id,
        run: () =>
          service().linkToOrganization({
            ...input,
            operatorId: operator.userId,
          }),
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

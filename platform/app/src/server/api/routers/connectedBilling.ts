import { auditLog } from "@ee/audit-log/auditLog";
import { z } from "zod";
import { prisma } from "~/server/db";
import { adminSurfaceHidden } from "../../../../ee/admin/adminSurfaceHidden";
import { isAdmin as checkIsAdmin } from "../../../../ee/admin/isAdmin";
import { createConnectedBillingService } from "../../../../ee/billing/connected/connectedBilling.prisma";
import { readConnectedBillingOverview } from "../../../../ee/billing/connected/connectedBillingOverview";
import { createTRPCRouter, protectedProcedure } from "../trpc";

/**
 * Invoice billing for connected self-hosted customers (ADR-141, section 7).
 *
 * Gated like the license registry: the `ADMIN_EMAILS` staff list checked in
 * the handler, never an RBAC permission, and a denial is the shared 404 that
 * says nothing about why. A customer admin has no business onboarding their
 * own organization to a contract.
 *
 * Every mutation is safe to repeat: the service reads the ids it stored before
 * it calls the payment provider again.
 */

const NO_PERMISSION = {
  reason:
    "back-office surface gated on the ADMIN_EMAILS staff list, not on an RBAC permission; cross-tenant by design",
  allow: {
    organizationId:
      "names the customer organization being billed; the caller's reach is the ADMIN_EMAILS staff list and is never derived from this id",
  },
} as const;

/** The operator, or a 404 that says nothing about why. */
function requireOperator(user: { id: string; email?: string | null }): {
  userId: string;
} {
  if (!checkIsAdmin(user)) throw adminSurfaceHidden();
  return { userId: user.id };
}

const service = () => createConnectedBillingService(prisma);

const customer = z.object({ organizationId: z.string().min(1) });

const currency = z.enum(["USD", "EUR"]);

const bankTransfer = z
  .object({
    type: z.enum(["us_bank_transfer", "eu_bank_transfer"]),
    country: z.string().length(2).optional(),
  })
  .nullable();

const contractTerms = {
  termStartsAt: z.date(),
  termEndsAt: z.date(),
  seats: z.number().int().positive(),
  seatRateCents: z.number().int().min(0),
  seatCurrency: currency,
  commitUsdCents: z.number().int().min(0),
};

const invoiceTarget = z.object({ stripeInvoiceId: z.string().min(1) });

export const connectedBillingRouter = createTRPCRouter({
  get: protectedProcedure
    .input(customer)
    .noPermission(NO_PERMISSION)
    .query(async ({ ctx, input }) => {
      const operator = requireOperator(
        ctx.session.user.impersonator ?? ctx.session.user,
      );
      await auditLog({
        userId: operator.userId,
        action: "connectedBilling.get",
        args: { organizationId: input.organizationId },
        targetKind: "organization",
        targetId: input.organizationId,
      });
      return readConnectedBillingOverview({
        prisma,
        organizationId: input.organizationId,
      });
    }),

  onboard: protectedProcedure
    .input(
      customer.extend({
        organizationName: z.string().trim().min(1).max(200),
        billingEmail: z.string().email(),
        bankTransfer: bankTransfer.default(null),
        ...contractTerms,
      }),
    )
    .noPermission(NO_PERMISSION)
    .mutation(async ({ ctx, input }) => {
      const operator = requireOperator(
        ctx.session.user.impersonator ?? ctx.session.user,
      );
      const account = await service().onboard({
        ...input,
        operatorId: operator.userId,
      });
      await auditLog({
        userId: operator.userId,
        action: "connectedBilling.onboard",
        args: {
          organizationId: input.organizationId,
          seats: input.seats,
          commitUsdCents: input.commitUsdCents,
          termEndsAt: input.termEndsAt.toISOString(),
        },
        targetKind: "organization",
        targetId: input.organizationId,
      });
      return account;
    }),

  addCommit: protectedProcedure
    .input(customer.extend({ amountUsdCents: z.number().int().positive() }))
    .noPermission(NO_PERMISSION)
    .mutation(async ({ ctx, input }) => {
      const operator = requireOperator(
        ctx.session.user.impersonator ?? ctx.session.user,
      );
      const grant = await service().addCommit({
        ...input,
        operatorId: operator.userId,
      });
      await auditLog({
        userId: operator.userId,
        action: "connectedBilling.addCommit",
        args: {
          organizationId: input.organizationId,
          amountUsdCents: input.amountUsdCents,
        },
        targetKind: "organization",
        targetId: input.organizationId,
      });
      return grant;
    }),

  renew: protectedProcedure
    .input(customer.extend(contractTerms))
    .noPermission(NO_PERMISSION)
    .mutation(async ({ ctx, input }) => {
      const operator = requireOperator(
        ctx.session.user.impersonator ?? ctx.session.user,
      );
      const account = await service().renew({
        ...input,
        operatorId: operator.userId,
      });
      await auditLog({
        userId: operator.userId,
        action: "connectedBilling.renew",
        args: {
          organizationId: input.organizationId,
          commitUsdCents: input.commitUsdCents,
          termEndsAt: input.termEndsAt.toISOString(),
        },
        targetKind: "organization",
        targetId: input.organizationId,
      });
      return account;
    }),

  completeRenewalIfDue: protectedProcedure
    .input(customer)
    .noPermission(NO_PERMISSION)
    .mutation(async ({ ctx, input }) => {
      const operator = requireOperator(
        ctx.session.user.impersonator ?? ctx.session.user,
      );
      const outcome = await service().completeRenewalIfDue(input);
      await auditLog({
        userId: operator.userId,
        action: "connectedBilling.completeRenewalIfDue",
        args: { organizationId: input.organizationId, outcome },
        targetKind: "organization",
        targetId: input.organizationId,
      });
      return { outcome };
    }),

  markPaidOutOfBand: protectedProcedure
    .input(invoiceTarget)
    .noPermission({ reason: NO_PERMISSION.reason })
    .mutation(async ({ ctx, input }) => {
      const operator = requireOperator(
        ctx.session.user.impersonator ?? ctx.session.user,
      );
      await service().markPaidOutOfBand(input);
      await auditLog({
        userId: operator.userId,
        action: "connectedBilling.markPaidOutOfBand",
        args: { stripeInvoiceId: input.stripeInvoiceId },
        targetKind: "invoice",
        targetId: input.stripeInvoiceId,
      });
      return { stripeInvoiceId: input.stripeInvoiceId };
    }),
});

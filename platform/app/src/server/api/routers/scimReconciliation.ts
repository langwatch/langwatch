import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { scimReconciliation } from "~/server/app-layer/identity/scim-reconciliation-runtime";
import { assertEnterprisePlan, ENTERPRISE_FEATURE_ERRORS } from "../enterprise";

/**
 * The organization's read of its own directory sync (ADR-122).
 *
 * Gated on `sso:view` — SEEING sync status is a different job from managing
 * it, and a security reviewer checking whether the directory removed a leaver
 * has no business being handed a control that mints credentials. Minting,
 * revoking and group mapping stay on `sso:manage` (see `scimToken.ts`).
 *
 * Read-only, deliberately and permanently: the organization view offers no
 * retry, because the remediation for a failed apply is the directory's next
 * push, which re-asserts everything the directory still believes. A control
 * here would be a second thing pushing the same state.
 *
 * The organization is the thing the query is BUILT from, not a filter: the
 * service takes it and never accepts a connection id on its own, so naming
 * another organization's connection answers as if it did not exist.
 */
/**
 * The same read, WITHOUT the plan assertion.
 *
 * Only the request log uses it, and the reason is that the log's headline
 * case is a plan that lapsed: `plan_not_entitled` refusals are recorded so an
 * administrator can find out why their directory stopped syncing. Gating the
 * reader on the plan means the one organization that needs those rows is the
 * one organization refused them — the answer to "why did my push stop"
 * withheld on the grounds that the push stopped.
 *
 * `sso:view` still applies. What is dropped is entitlement, not permission.
 */
const scimRequestLogProcedure = protectedProcedure
  .input(z.object({ organizationId: z.string().min(1) }))
  .permission("sso:view");

const scimViewProcedure = protectedProcedure
  .input(z.object({ organizationId: z.string().min(1) }))
  .permission("sso:view")
  .use(async ({ ctx, input, next }) => {
    await assertEnterprisePlan({
      organizationId: input.organizationId,
      errorMessage: ENTERPRISE_FEATURE_ERRORS.SCIM,
    });
    return next({ ctx });
  });

export const scimReconciliationRouter = createTRPCRouter({
  getAll: scimViewProcedure.query(async ({ input }) =>
    scimReconciliation().getAll({ organizationId: input.organizationId }),
  ),

  /**
   * What the directory has been doing on one connection (ADR-126).
   *
   * `sso:view` like the rest of this router: reading the sequence is the same
   * job as reading the state, and a reader trusted with one is trusted with
   * the other. Naming another organization's connection reads that
   * organization's log with this organization's tenant and finds nothing.
   */
  getActivity: scimViewProcedure
    .input(z.object({ connectionId: z.string().min(1) }))
    .query(async ({ input }) =>
      scimReconciliation().getActivity({
        organizationId: input.organizationId,
        connectionId: input.connectionId,
      }),
    ),

  /**
   * Every request the directory made on one connection (ADR-126).
   *
   * Beside `getActivity` and not folded into it: the log says what the
   * directory DECIDED, this says what it ASKED and what we answered, and the
   * push that never reached a handler exists only here.
   */
  getRequests: scimRequestLogProcedure
    .input(z.object({ connectionId: z.string().min(1) }))
    .query(async ({ input }) =>
      scimReconciliation().getRequests({
        organizationId: input.organizationId,
        connectionId: input.connectionId,
      }),
    ),

  getById: scimViewProcedure
    .input(z.object({ connectionId: z.string().min(1) }))
    .query(async ({ input }) =>
      scimReconciliation().getById({
        organizationId: input.organizationId,
        connectionId: input.connectionId,
      }),
    ),
});

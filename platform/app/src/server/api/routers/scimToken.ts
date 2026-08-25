import { ScimTokenService } from "@ee/scim/scim-token.service";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { assertEnterprisePlan, ENTERPRISE_FEATURE_ERRORS } from "../enterprise";

/**
 * Minting and revoking directory tokens takes `sso:manage` (ADR-122).
 *
 * It used to take `organization:manage`, which is a coarser thing entirely: a
 * directory token is the whole write authority a directory holds over an
 * organization's membership, and handing it out with the permission that also
 * renames the organization made "may administer the organization" and "may
 * issue provisioning credentials" one decision when they are two. Seeing sync
 * status is `sso:view` and lives in `scimReconciliation.ts`; a reader who has
 * that and not this reads the panel and is offered no control.
 */
const enterpriseScimProcedure = protectedProcedure
  .input(z.object({ organizationId: z.string() }))
  .permission("sso:manage")
  .use(async ({ ctx, input, next }) => {
    await assertEnterprisePlan({
      organizationId: input.organizationId,
      errorMessage: ENTERPRISE_FEATURE_ERRORS.SCIM,
    });
    return next({ ctx });
  });

/**
 * Listing tokens is SEEING, not managing. It hands out no value and no hash —
 * an id, a description, which connection each one reaches and when it was
 * last used — and a reader who may see single sign-on has to be able to
 * answer "is a token even configured for this connection" without being
 * offered the control that issues one.
 */
const enterpriseScimReadProcedure = protectedProcedure
  .input(z.object({ organizationId: z.string() }))
  .permission("sso:view")
  .use(async ({ ctx, input, next }) => {
    await assertEnterprisePlan({
      organizationId: input.organizationId,
      errorMessage: ENTERPRISE_FEATURE_ERRORS.SCIM,
    });
    return next({ ctx });
  });

export const scimTokenRouter = createTRPCRouter({
  list: enterpriseScimReadProcedure.query(async ({ ctx, input }) => {
    const tokenService = ScimTokenService.create(ctx.prisma);
    return tokenService.list({ organizationId: input.organizationId });
  }),

  generate: enterpriseScimProcedure
    .input(
      z.object({
        description: z.string().optional(),
        // D08: which connection this token is for. Optional on the wire and
        // required by the service, so a client that has not been updated
        // gets the named `scim_connection_required` refusal rather than a
        // schema error the customer cannot read.
        connectionId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tokenService = ScimTokenService.create(ctx.prisma);
      return tokenService.generate({
        organizationId: input.organizationId,
        connectionId: input.connectionId,
        description: input.description,
      });
    }),

  revoke: enterpriseScimProcedure
    .input(
      z.object({
        tokenId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tokenService = ScimTokenService.create(ctx.prisma);
      return tokenService.revoke({
        organizationId: input.organizationId,
        tokenId: input.tokenId,
      });
    }),
});

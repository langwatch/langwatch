import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

import { getApp } from "~/server/app-layer/app";

import { checkProjectPermission } from "../rbac";

const resourceType = z.enum(["TRACE", "THREAD"]);
const visibility = z.enum(["PUBLIC", "ORGANIZATION", "PROJECT"]);

/**
 * Share-link management. Anonymous reads DO NOT live here — they go through the
 * dedicated `sharedTrace.get` surface. This router only mints, lists and revokes
 * links, all behind `traces:share`; the domain guards (sharing kill switch,
 * thread derivation) live in ShareService and surface as HandledErrors. See
 * ADR-057.
 */
export const shareRouter = createTRPCRouter({
  /**
   * All links for a resource — backs the management list in the share drawer.
   * Requires `traces:share` (not `traces:view`): the list re-displays the secret
   * tokens, so only someone who can mint/revoke shares may enumerate them.
   */
  listForResource: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        resourceType,
        resourceId: z.string(),
      }),
    )
    .use(checkProjectPermission("traces:share"))
    .query(async ({ input }) => {
      return getApp().share.listForResource(input);
    }),

  /**
   * Mint a share link. TRACE only: `sharedTrace.get` can render a trace and
   * nothing else, so accepting THREAD here would mint a capability no viewer
   * can redeem. Thread sharing is parked until the aggregate can carry the
   * surrounding conversation — see ADR-057's follow-ups.
   */
  createShare: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        resourceType: z.literal("TRACE"),
        resourceId: z.string(),
        visibility: visibility.default("PUBLIC"),
        expiresAt: z.date().nullish(),
        maxViews: z.number().int().positive().nullish(),
      }),
    )
    .use(checkProjectPermission("traces:share"))
    .mutation(async ({ input, ctx }) => {
      return getApp().share.createShare({
        projectId: input.projectId,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        visibility: input.visibility,
        expiresAt: input.expiresAt ?? null,
        maxViews: input.maxViews ?? null,
        userId: ctx.session.user.id,
      });
    }),

  /** Revoke a single link by id. */
  revoke: protectedProcedure
    .input(z.object({ projectId: z.string(), id: z.string() }))
    .use(checkProjectPermission("traces:share"))
    .mutation(async ({ input }) => {
      await getApp().share.revokeById(input);
    }),

  revokeAllTraceShares: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("project:update"))
    .mutation(async ({ input }) => {
      await getApp().share.revokeAllTraceShares(input.projectId);
    }),
});

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from "~/server/api/trpc";

import { getApp } from "~/server/app-layer/app";
import type { ShareViewer } from "~/server/app-layer/share/share.service";
import { buildShareGrantCookie } from "~/server/app-layer/share/shareGrant";

import {
  checkProjectPermission,
  createShareAudienceViewer,
  skipPermissionCheck,
} from "../rbac";

const resourceType = z.enum(["TRACE", "THREAD"]);
const visibility = z.enum(["PUBLIC", "ORGANIZATION", "PROJECT"]);

export const shareRouter = createTRPCRouter({
  /**
   * Exchange a share token for a scoped viewing grant. Validates expiry, view
   * cap and audience, consumes one view (unless the viewer already holds a
   * grant for this share — an in-window refresh), and sets an httpOnly grant
   * cookie the anonymous data reads ride on. See ADR-039.
   */
  resolve: publicProcedure
    .input(z.object({ token: z.string() }))
    .use(skipPermissionCheck)
    .mutation(async ({ input, ctx }) => {
      const viewer: ShareViewer = {
        grantedShareId: ctx.shareGrant?.share_id ?? null,
        // Same audience closures the grant-revalidation path uses; keep them
        // in one place so resolve and validate can't drift apart.
        ...createShareAudienceViewer(ctx),
      };

      const result = await getApp().share.resolveForViewer({
        token: input.token,
        viewer,
      });

      switch (result.status) {
        case "not_found":
        case "sharing_disabled":
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "This share link is not available.",
          });
        case "expired":
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "This share link has expired.",
          });
        case "exhausted":
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "This share link has already been viewed.",
          });
        case "forbidden":
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "You do not have access to this shared item.",
          });
        case "granted": {
          const { share, grant } = result;
          // Without the grant cookie the viewer cannot read anything, so a
          // transport that cannot set it must fail loudly rather than hand back
          // a 200 that silently grants nothing.
          if (!ctx.resHeaders) {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Cannot issue a share grant on this transport.",
            });
          }
          ctx.resHeaders.append("set-cookie", buildShareGrantCookie(grant.jwt));
          return {
            shareId: share.id,
            projectId: share.projectId,
            resourceType: share.resourceType,
            resourceId: share.resourceId,
            threadId: share.threadId,
          };
        }
        default: {
          const _exhaustive: never = result;
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Unhandled share resolution result: ${JSON.stringify(_exhaustive)}`,
          });
        }
      }
    }),

  /**
   * Non-consuming descriptor lookup by token — used by the share page to render
   * project chrome. Data access still requires a grant from `resolve`.
   */
  getShared: publicProcedure
    .input(z.object({ token: z.string() }))
    .use(skipPermissionCheck)
    .query(async ({ input }) => {
      const share = await getApp().share.getShareableByToken(input.token);
      if (!share) return null;
      return {
        id: share.id,
        projectId: share.projectId,
        resourceType: share.resourceType,
        resourceId: share.resourceId,
        threadId: share.threadId,
      };
    }),

  /** All links for a resource — backs the management list in the share drawer. */
  listForResource: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        resourceType,
        resourceId: z.string(),
      }),
    )
    .use(checkProjectPermission("traces:view"))
    .query(async ({ input }) => {
      return getApp().share.listForResource(input);
    }),

  createShare: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        resourceType,
        resourceId: z.string(),
        threadId: z.string().nullish(),
        visibility: visibility.default("PUBLIC"),
        expiresAt: z.date().nullish(),
        maxViews: z.number().int().positive().nullish(),
      }),
    )
    .use(checkProjectPermission("traces:share"))
    .mutation(async ({ input, ctx }) => {
      const { projectId, resourceType: type, resourceId } = input;

      if (type === "TRACE") {
        const project = await getApp().projects.getById(projectId);
        if (!project?.traceSharingEnabled) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Trace sharing is disabled for this project",
          });
        }
      }

      return getApp().share.createShare({
        projectId,
        resourceType: type,
        resourceId,
        threadId: input.threadId ?? null,
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

/**
 * tRPC router for the project's Slack integration (ADR-093 §5).
 *
 *   getStatus:            whether Slack is connected for a project and which
 *                         workspace it reaches. Never the token.
 *   getLegacyTokenCensus: the automations in the project that still carry their
 *                         own Slack token — the migration's progress meter.
 *   connect:              set up or rotate the connection. The token is
 *                         validated against Slack before anything is stored.
 *   disconnect:           drop the connection.
 *   switchToIntegration:  clear the stored token on one or several automations
 *                         so their delivery falls through to the integration.
 *
 * Reading the connection state takes `triggers:view`, which every member of the
 * project holds, because the composer has to tell an author whether Slack is
 * connected before it knows whether to show a channel picker or a "connect
 * Slack" pointer. Changing it takes `project:update` — a bot token reaches the
 * whole workspace, and the composer is not where that decision belongs.
 *
 * Transport only: gates and delegation to the app-layer service.
 *
 * Spec: specs/automations/source-merge.feature.
 */

import { z } from "zod";
import {
  checkProjectPermission,
  resolveProjectPermission,
} from "~/server/api/rbac";
import { createSlackIntegrationService } from "~/server/app-layer/automations/slack-integration/slack-integration.wiring";
import { resolveOrganizationId } from "~/server/organizations/resolveOrganizationId";
import { createTRPCRouter, protectedProcedure } from "../trpc";

export const slackIntegrationRouter = createTRPCRouter({
  getStatus: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("triggers:view"))
    .query(async ({ ctx, input }) => {
      const status = await createSlackIntegrationService({
        prisma: ctx.prisma,
      }).getStatus({ projectId: input.projectId });
      // Whether THIS caller may change the connection of THIS project — the
      // settings picker can reach projects the session is not on, and the
      // session project's permission says nothing about those.
      const { permitted } = await resolveProjectPermission(
        ctx,
        input.projectId,
        "project:update",
      );
      return { ...status, canManage: permitted };
    }),

  getLegacyTokenCensus: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("triggers:view"))
    .query(async ({ ctx, input }) => {
      const automations = await createSlackIntegrationService({
        prisma: ctx.prisma,
      }).getLegacyTokenAutomations({ projectId: input.projectId });
      return { count: automations.length, automations };
    }),

  connect: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        botToken: z.string().min(1),
      }),
    )
    .use(checkProjectPermission("project:update"))
    .mutation(async ({ ctx, input }) => {
      const organizationId = await resolveOrganizationId(input.projectId);
      if (!organizationId) {
        // Every project hangs off a team and an organization, so a project
        // without one is a data-integrity anomaly the customer cannot act on
        // — it degrades to the generic unknown with a trace id, per ADR-045.
        throw new Error(
          `project ${input.projectId} resolves to no organization`,
        );
      }
      return createSlackIntegrationService({ prisma: ctx.prisma }).setup({
        projectId: input.projectId,
        organizationId,
        botToken: input.botToken,
        userId: ctx.session.user.id,
      });
    }),

  disconnect: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("project:update"))
    .mutation(async ({ ctx, input }) => {
      await createSlackIntegrationService({ prisma: ctx.prisma }).remove({
        projectId: input.projectId,
      });
    }),

  switchToIntegration: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        // Absent means every automation in the project that still stores one —
        // the settings card's bulk action. A single id is the row and drawer
        // nudge.
        automationIds: z.array(z.string()).optional(),
      }),
    )
    .use(checkProjectPermission("project:update"))
    .mutation(async ({ ctx, input }) => {
      return createSlackIntegrationService({
        prisma: ctx.prisma,
      }).clearLegacyTokens({
        projectId: input.projectId,
        triggerIds: input.automationIds,
      });
    }),
});

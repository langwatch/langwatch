/**
 * tRPC router for named Slack connections (ADR-093 §5a). Listing needs
 * `project:view`; changing a PROJECT connection needs `project:update` there,
 * an ORGANIZATION one `organization:manage`, and moving scope needs both ends.
 * Transport only. Spec: specs/automations/slack-connections.feature.
 */

import { z } from "zod";
import { InvalidActionParamsError } from "~/server/app-layer/automations/errors";
import type { SlackProjectScope } from "~/server/app-layer/automations/slack-integration/repositories/slack-integration.repository";
import { createSlackIntegrationService } from "~/server/app-layer/automations/slack-integration/slack-integration.wiring";
import {
  probeOrganizationPermission,
  probeProjectPermission,
  requireOrganizationPermission,
  requireProjectPermission,
} from "~/server/app-layer/permissions/imperative";
import { createTRPCRouter, protectedProcedure } from "../trpc";

const kindSchema = z.enum(["BOT", "INCOMING_WEBHOOK"]);
const scopeTypeSchema = z.enum(["ORGANIZATION", "PROJECT"]);
const nameSchema = z.string().trim().min(1).max(120);
const secretSchema = z.string().trim().min(1);

const SLACK_WEBHOOK_PREFIX = "https://hooks.slack.com/";
const webhookMessage = `Expected a Slack incoming webhook URL (${SLACK_WEBHOOK_PREFIX}…).`;

type ScopeTarget = {
  scopeType: z.infer<typeof scopeTypeSchema>;
  scopeId: string;
};

type PermissionContext = Parameters<typeof requireProjectPermission>[0];

/** A connection may only be scoped to the calling project or its organization. */
function assertReachableScope({
  scope,
  target,
}: {
  scope: SlackProjectScope;
  target: ScopeTarget;
}): void {
  const expected =
    target.scopeType === "ORGANIZATION"
      ? scope.organizationId
      : scope.projectId;
  if (target.scopeId !== expected) {
    throw new InvalidActionParamsError(
      "A Slack connection is scoped to this project or to its organization.",
      "scopeId",
    );
  }
}

async function requireManage({
  ctx,
  target,
}: {
  ctx: PermissionContext;
  target: ScopeTarget;
}): Promise<void> {
  if (target.scopeType === "ORGANIZATION") {
    await requireOrganizationPermission(
      ctx,
      target.scopeId,
      "organization:manage",
    );
    return;
  }
  await requireProjectPermission(ctx, target.scopeId, "project:update");
}

/** Where an edit moves a connection; a bare scope type means this project or org. */
function targetScope({
  connection,
  scope,
  scopeType,
  scopeId,
}: {
  connection: ScopeTarget;
  scope: SlackProjectScope;
  scopeType?: ScopeTarget["scopeType"];
  scopeId?: string;
}): ScopeTarget {
  const type = scopeType ?? connection.scopeType;
  if (scopeId !== undefined) return { scopeType: type, scopeId };
  if (type === connection.scopeType) {
    return { scopeType: type, scopeId: connection.scopeId };
  }
  return {
    scopeType: type,
    scopeId: type === "ORGANIZATION" ? scope.organizationId : scope.projectId,
  };
}

export const slackIntegrationRouter = createTRPCRouter({
  list: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .permission("project:view")
    .query(async ({ ctx, input }) => {
      const { scope, connections } = await createSlackIntegrationService({
        prisma: ctx.prisma,
      }).listForProject({ projectId: input.projectId });
      const [canManageProject, canManageOrganization] = await Promise.all([
        probeProjectPermission(ctx, input.projectId, "project:update"),
        probeOrganizationPermission(
          ctx,
          scope.organizationId,
          "organization:manage",
        ),
      ]);
      return {
        connections: connections.map((connection) => ({
          ...connection,
          canManage:
            connection.scopeType === "ORGANIZATION"
              ? canManageOrganization
              : canManageProject,
        })),
        canManageProject,
        canManageOrganization,
      };
    }),

  create: protectedProcedure
    .input(
      z
        .object({
          projectId: z.string(),
          name: nameSchema,
          kind: kindSchema,
          scopeType: scopeTypeSchema,
          scopeId: z.string(),
          secret: secretSchema,
        })
        .refine(
          (input) =>
            input.kind !== "INCOMING_WEBHOOK" ||
            input.secret.startsWith(SLACK_WEBHOOK_PREFIX),
          { message: webhookMessage, path: ["secret"] },
        ),
    )
    .permission("project:view")
    .mutation(async ({ ctx, input }) => {
      const service = createSlackIntegrationService({ prisma: ctx.prisma });
      const scope = await service.getProjectScope({
        projectId: input.projectId,
      });
      const target = { scopeType: input.scopeType, scopeId: input.scopeId };
      assertReachableScope({ scope, target });
      await requireManage({ ctx, target });
      const connection = await service.create({
        scope,
        name: input.name,
        kind: input.kind,
        scopeType: input.scopeType,
        scopeId: input.scopeId,
        secret: input.secret,
        actorId: ctx.session.user.id,
      });
      return { ...connection, canManage: true };
    }),

  update: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        id: z.string(),
        name: nameSchema.optional(),
        scopeType: scopeTypeSchema.optional(),
        scopeId: z.string().optional(),
        secret: secretSchema.optional(),
        /** Confirms narrowing a connection other projects deliver through. */
        force: z.boolean().optional(),
      }),
    )
    .permission("project:view")
    .mutation(async ({ ctx, input }) => {
      const service = createSlackIntegrationService({ prisma: ctx.prisma });
      const { connection, scope } = await service.getUsableByProject({
        id: input.id,
        projectId: input.projectId,
      });
      await requireManage({ ctx, target: connection });

      const target = targetScope({
        connection,
        scope,
        scopeType: input.scopeType,
        scopeId: input.scopeId,
      });
      const moves =
        target.scopeType !== connection.scopeType ||
        target.scopeId !== connection.scopeId;
      if (moves) {
        assertReachableScope({ scope, target });
        await requireManage({ ctx, target });
      }
      if (
        input.secret !== undefined &&
        connection.kind === "INCOMING_WEBHOOK" &&
        !input.secret.startsWith(SLACK_WEBHOOK_PREFIX)
      ) {
        throw new InvalidActionParamsError(webhookMessage, "secret");
      }

      const updated = await service.update({
        scope,
        connection,
        name: input.name,
        ...(moves ? target : {}),
        secret: input.secret,
        actorId: ctx.session.user.id,
        force: input.force ?? false,
      });
      return { ...updated, canManage: true };
    }),

  delete: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        id: z.string(),
        force: z.boolean().optional(),
      }),
    )
    .permission("project:view")
    .mutation(async ({ ctx, input }) => {
      const service = createSlackIntegrationService({ prisma: ctx.prisma });
      const { connection } = await service.getUsableByProject({
        id: input.id,
        projectId: input.projectId,
      });
      await requireManage({ ctx, target: connection });
      return service.delete({ connection, force: input.force ?? false });
    }),
});

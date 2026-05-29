import { AlertType, TriggerAction } from "@prisma/client";
import { RoleService } from "~/server/role/role.service";
import { TRPCError } from "@trpc/server";
import { generate as ksuid } from "@langwatch/ksuid";
import { z } from "zod";
import { KSUID_RESOURCES } from "~/utils/constants";
import { getApp } from "~/server/app-layer/app";
import { DomainError } from "~/server/app-layer/domain-error";
import {
  InvalidEmailRecipientError,
  MissingAnnotatorError,
  MissingSlackWebhookError,
  ProjectNotFoundError,
} from "~/server/app-layer/triggers/errors";
import { EMAIL_RX } from "~/automations/providers/definitions/email/shared";
import {
  type DraftProject,
  validateTemplateDraft,
} from "~/server/app-layer/triggers/trigger-template.service";
import { enforceLicenseLimit } from "../../license-enforcement";
import {
  sanitizeTriggerFilters,
  triggerFiltersSchema,
  triggerFiltersPermissiveSchema,
} from "../../filters/types";
import { checkProjectPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { extractCheckKeys } from "../utils";

const templateDraftSchema = z.object({
  slackTemplateType: z.string().nullable().optional(),
  slackTemplate: z.string().nullable().optional(),
  emailSubjectTemplate: z.string().nullable().optional(),
  emailBodyTemplate: z.string().nullable().optional(),
});

const triggerIdentitySchema = z.object({
  name: z.string(),
  alertType: z.nativeEnum(AlertType).nullable().default(null),
  message: z.string().nullable().default(null),
});

const actionParamsSchema = z.object({
  createdByUserId: z.string().optional(),
  members: z.string().array().optional(),
  slackWebhook: z.string().optional(),
  datasetId: z.string().optional(),
  datasetMapping: z
    .object({ mapping: z.any(), expansions: z.array(z.string()).optional() })
    .optional(),
  annotators: z
    .array(z.object({ id: z.string(), name: z.string() }))
    .optional(),
});

type TRPCErrorCode = ConstructorParameters<typeof TRPCError>[0]["code"];

function httpStatusToTRPCCode(httpStatus: number): TRPCErrorCode {
  switch (httpStatus) {
    case 400:
      return "BAD_REQUEST";
    case 401:
      return "UNAUTHORIZED";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "NOT_FOUND";
    case 409:
      return "CONFLICT";
    case 422:
      return "UNPROCESSABLE_CONTENT";
    case 429:
      return "TOO_MANY_REQUESTS";
    default:
      return "INTERNAL_SERVER_ERROR";
  }
}

/**
 * Wraps any thrown value as a `TRPCError` whose `cause` is preserved when the
 * value is a `DomainError`. The shared `errorFormatter` in `trpc.ts` serialises
 * that cause as `error.data.domainError = { kind, meta, telemetry, … }` so the
 * client gets the full structured payload — that is the "incredibly good error
 * handling" surface (see ADR-028 follow-up).
 */
function toTemplateTRPCError(err: unknown): TRPCError {
  if (err instanceof TRPCError) return err;
  if (err instanceof DomainError) {
    return new TRPCError({
      code: httpStatusToTRPCCode(err.httpStatus),
      message: err.message,
      cause: err,
    });
  }
  return new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: err instanceof Error ? err.message : "Unexpected error",
    cause: err instanceof Error ? err : undefined,
  });
}

async function resolveProjectIdentity(projectId: string): Promise<DraftProject> {
  const project = await getApp().projects.getById(projectId);
  if (!project) throw new ProjectNotFoundError(projectId);
  return { name: project.name, slug: project.slug };
}

/**
 * Mirrors the team-membership check the create procedure already does: every
 * Recipients are validated by RFC shape only — external addresses are
 * intentionally allowed (Slack's "email to a channel" pattern). The UI
 * surfaces an "External" warning badge for non-team addresses.
 *
 * A future per-project "strict mode" flag will re-enable team-membership
 * enforcement via `RecipientNotInTeamError`; that gate is not in this PR.
 */
function validateEmailRecipientFormats(recipients: string[]): void {
  for (const email of recipients) {
    if (!EMAIL_RX.test(email)) {
      throw new InvalidEmailRecipientError(email);
    }
  }
}

export const automationRouter = createTRPCRouter({
  create: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        name: z.string(),
        action: z.nativeEnum(TriggerAction),
        filters: triggerFiltersSchema,
        actionParams: z.object({
          createdByUserId: z.string().optional(),
          members: z.string().array().optional(),
          slackWebhook: z.string().optional(),
          datasetId: z.string().optional(),
          datasetMapping: z
            .object({
              mapping: z.any(),
              expansions: z.array(z.string()).optional(),
            })
            .optional(),
          annotators: z
            .array(
              z.object({
                id: z.string(),
                name: z.string(),
              }),
            )
            .optional(),
        }),
      }),
    )
    .use(checkProjectPermission("triggers:create"))
    .mutation(async ({ ctx, input }) => {
      await enforceLicenseLimit(ctx, input.projectId, "automations");

      const project = await ctx.prisma.project.findUnique({
        where: {
          id: input.projectId,
        },
        select: {
          teamId: true,
          team: { select: { organizationId: true } },
        },
      });

      if (!project) {
        throw new Error(`Project with id ${input.projectId} not found`);
      }

      const roleService = new RoleService(ctx.prisma);
      const teamBindings = await roleService.getTeamMembersWithUsers({
        organizationId: project.team.organizationId,
        teamId: project.teamId,
      });

      if (input.action === TriggerAction.ADD_TO_ANNOTATION_QUEUE) {
        input.actionParams.createdByUserId = ctx.session?.user.id;

        if (!input.actionParams.annotators) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Annotators are required",
          });
        }
      }

      if (input.action === TriggerAction.SEND_SLACK_MESSAGE) {
        if (!input.actionParams.slackWebhook) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Slack webhook is required",
          });
        }
      } else if (input.action === TriggerAction.SEND_EMAIL) {
        const teamEmails = teamBindings
          .flatMap((b) => (b.user ? [b.user.email] : []));

        if (input.actionParams.members) {
          input.actionParams.members.map((email: string) => {
            if (!teamEmails.includes(email)) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Error with selected emails",
              });
            }
          });
        }
      }

      const trigger = await ctx.prisma.trigger.create({
        data: {
          id: ksuid(KSUID_RESOURCES.TRIGGER).toString(),
          name: input.name,
          action: input.action,
          actionParams: input.actionParams,
          filters: JSON.stringify(input.filters),
          projectId: input.projectId,
          lastRunAt: new Date().getTime(),
        },
      });

      await getApp().triggers.invalidate(input.projectId);

      return trigger;
    }),
  deleteById: protectedProcedure
    .input(z.object({ projectId: z.string(), triggerId: z.string() }))
    .use(checkProjectPermission("triggers:delete"))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.trigger.update({
        where: {
          id: input.triggerId,
          projectId: input.projectId,
        },
        data: {
          deleted: true,
          active: false,
        },
      });

      await getApp().triggers.invalidate(input.projectId);

      return { success: true };
    }),
  addCustomMessage: protectedProcedure
    .input(
      z.object({
        triggerId: z.string(),
        message: z.string(),
        projectId: z.string(),
        alertType: z
          .union([z.nativeEnum(AlertType), z.literal("")])
          .optional()
          .nullable(),
        name: z.string().optional(),
      }),
    )
    .use(checkProjectPermission("triggers:update"))
    .mutation(async ({ ctx, input }) => {
      const trigger = await ctx.prisma.trigger.update({
        where: { id: input.triggerId, projectId: input.projectId },
        data: {
          message: input.message,
          alertType: input.alertType ? input.alertType : null,
          name: input.name,
        },
      });

      await getApp().triggers.invalidate(input.projectId);

      return trigger;
    }),
  getTriggers: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("triggers:view"))
    .query(async ({ ctx, input }) => {
      const triggers = await ctx.prisma.trigger.findMany({
        where: {
          projectId: input.projectId,
          deleted: false,
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      const allCheckIds = triggers.flatMap((trigger) => {
        if (typeof trigger.filters === "string") {
          const triggerFilters = JSON.parse(trigger.filters);
          return extractCheckKeys(triggerFilters);
        } else {
          return [];
        }
      });

      const allChecks = await ctx.prisma.monitor.findMany({
        where: {
          id: {
            in: allCheckIds,
          },
          projectId: input.projectId,
        },
      });

      const checksMap = allChecks.reduce<
        Record<string, (typeof allChecks)[number]>
      >((map, check) => {
        map[check.id] = check;
        return map;
      }, {});

      const enhancedTriggers = triggers.map((trigger) => {
        let triggerFilters: Record<string, any> = {};

        if (typeof trigger.filters === "string") {
          triggerFilters = JSON.parse(trigger.filters);
        }

        const checkIds = extractCheckKeys(triggerFilters);

        const checks = checkIds.map((id) => checksMap[id]).filter(Boolean);

        return {
          ...trigger,
          checks,
        };
      });

      return enhancedTriggers;
    }),
  toggleTrigger: protectedProcedure
    .input(
      z.object({
        triggerId: z.string(),
        active: z.boolean(),
        projectId: z.string(),
      }),
    )
    .use(checkProjectPermission("triggers:update"))
    .mutation(async ({ ctx, input }) => {
      const trigger = await ctx.prisma.trigger.update({
        where: {
          id: input.triggerId,
          projectId: input.projectId,
        },
        data: {
          active: input.active,
        },
      });

      await getApp().triggers.invalidate(input.projectId);

      return trigger;
    }),
  getTriggerById: protectedProcedure
    .input(z.object({ triggerId: z.string(), projectId: z.string() }))
    .use(checkProjectPermission("triggers:view"))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.trigger.findUnique({
        where: { id: input.triggerId, projectId: input.projectId },
      });
    }),
  updateTriggerFilters: protectedProcedure
    .input(
      z.object({
        triggerId: z.string(),
        projectId: z.string(),
        filters: triggerFiltersPermissiveSchema,
      }),
    )
    .use(checkProjectPermission("triggers:update"))
    .mutation(async ({ ctx, input }) => {
      const { sanitized, unknownFields } = sanitizeTriggerFilters(
        input.filters,
      );

      if (unknownFields.length > 0 && Object.keys(sanitized).length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "This automation only contains unsupported legacy filters. Add at least one supported filter before saving.",
        });
      }

      const trigger = await ctx.prisma.trigger.update({
        where: { id: input.triggerId, projectId: input.projectId },
        data: {
          filters: JSON.stringify(sanitized),
        },
      });

      await getApp().triggers.invalidate(input.projectId);

      return trigger;
    }),
  getTemplateScaffold: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("triggers:view"))
    .query(async ({ input }) => {
      const project = await resolveProjectIdentity(input.projectId);
      return getApp().triggerTemplates.getScaffold({ project });
    }),
  previewTemplate: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        channel: z.enum(["email", "slack"]),
        trigger: triggerIdentitySchema,
        draft: templateDraftSchema,
      }),
    )
    .use(checkProjectPermission("triggers:view"))
    .mutation(async ({ input }) => {
      try {
        const project = await resolveProjectIdentity(input.projectId);
        return await getApp().triggerTemplates.renderPreview({
          channel: input.channel,
          trigger: input.trigger,
          project,
          draft: input.draft,
        });
      } catch (err) {
        throw toTemplateTRPCError(err);
      }
    }),
  testFireTemplate: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        channel: z.enum(["email", "slack"]),
        trigger: triggerIdentitySchema,
        draft: templateDraftSchema,
        recipients: z.string().array().default([]),
        webhook: z.string().nullable().default(null),
      }),
    )
    .use(checkProjectPermission("triggers:update"))
    .mutation(async ({ ctx, input }) => {
      try {
        if (input.channel === "email") {
          validateEmailRecipientFormats(input.recipients);
        }
        const project = await resolveProjectIdentity(input.projectId);
        return await getApp().triggerTemplates.testFire({
          channel: input.channel,
          trigger: input.trigger,
          project,
          draft: input.draft,
          recipients: input.recipients,
          webhook: input.webhook,
        });
      } catch (err) {
        throw toTemplateTRPCError(err);
      }
    }),
  upsert: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        triggerId: z.string().optional(),
        name: z.string().min(1),
        action: z.nativeEnum(TriggerAction),
        alertType: z.nativeEnum(AlertType).nullable().optional(),
        message: z.string().nullable().optional(),
        filters: triggerFiltersSchema,
        customGraphId: z.string().nullable().optional(),
        actionParams: actionParamsSchema,
        templates: templateDraftSchema,
      }),
    )
    .use(checkProjectPermission("triggers:update"))
    .mutation(async ({ ctx, input }) => {
      try {
        validateTemplateDraft(input.templates);
        if (
          input.action === TriggerAction.SEND_EMAIL &&
          input.actionParams.members &&
          input.actionParams.members.length > 0
        ) {
          validateEmailRecipientFormats(input.actionParams.members);
        }
        if (
          input.action === TriggerAction.SEND_SLACK_MESSAGE &&
          !input.actionParams.slackWebhook
        ) {
          throw new MissingSlackWebhookError();
        }
        if (
          input.action === TriggerAction.ADD_TO_ANNOTATION_QUEUE &&
          (!input.actionParams.annotators ||
            input.actionParams.annotators.length === 0)
        ) {
          throw new MissingAnnotatorError();
        }
      } catch (err) {
        throw toTemplateTRPCError(err);
      }

      const data = {
        name: input.name,
        action: input.action,
        alertType: input.alertType ?? null,
        message: input.message ?? null,
        filters: JSON.stringify(input.filters),
        customGraphId: input.customGraphId ?? null,
        actionParams: input.actionParams,
        slackTemplateType: input.templates.slackTemplateType ?? null,
        slackTemplate: input.templates.slackTemplate ?? null,
        emailSubjectTemplate: input.templates.emailSubjectTemplate ?? null,
        emailBodyTemplate: input.templates.emailBodyTemplate ?? null,
      };

      let trigger;
      if (input.triggerId) {
        trigger = await ctx.prisma.trigger.update({
          where: { id: input.triggerId, projectId: input.projectId },
          data,
        });
      } else {
        await enforceLicenseLimit(ctx, input.projectId, "automations");
        trigger = await ctx.prisma.trigger.create({
          data: {
            id: ksuid(KSUID_RESOURCES.TRIGGER).toString(),
            projectId: input.projectId,
            lastRunAt: new Date().getTime(),
            ...data,
          },
        });
      }

      await getApp().triggers.invalidate(input.projectId);
      return trigger;
    }),
});

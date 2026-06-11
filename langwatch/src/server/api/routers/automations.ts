import { AlertType, TriggerAction } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { generate as ksuid } from "@langwatch/ksuid";
import { z } from "zod";
import { KSUID_RESOURCES } from "~/utils/constants";
import { getApp } from "~/server/app-layer/app";
import { DomainError } from "~/server/app-layer/domain-error";
import { NOTIFY_TRIGGER_ACTIONS } from "~/server/event-sourcing/pipelines/shared/triggerActionDispatch";
import {
  DEFAULT_TRACE_DEBOUNCE_MS,
  MAX_TRACE_DEBOUNCE_MS,
  MIN_TRACE_DEBOUNCE_MS,
  NOTIFICATION_CADENCES,
  type NotificationCadence,
} from "~/automations/cadences";
import {
  InvalidEmailRecipientError,
  MissingAnnotatorError,
  MissingSlackWebhookError,
  ProjectNotFoundError,
} from "~/server/app-layer/triggers/errors";
import { EMAIL_RX } from "~/automations/providers/definitions/email/shared";
import { actionParamsSchemaFor } from "~/automations/providers/server";
import {
  type DraftProject,
  validateTemplateDraft,
} from "~/server/app-layer/triggers/trigger-template.service";
import { enforceLicenseLimit } from "../../license-enforcement";
import { rateLimit } from "../../rateLimit";
import { buildRetryAfterMessage } from "./rateLimitMessage";
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

const notificationCadenceSchema = z.enum(NOTIFICATION_CADENCES);

// ADR-030: per-trigger trace-readiness debounce. Constrained on the wire so a
// hostile or buggy client can't pin a trace in the settle stage indefinitely.
const traceDebounceMsSchema = z
  .number()
  .int()
  .min(MIN_TRACE_DEBOUNCE_MS)
  .max(MAX_TRACE_DEBOUNCE_MS);

// ADR-025: cadence applies to notify actions only. New notify triggers default
// to a 5-minute digest (operator-friendly storm protection); persist actions
// are pinned to immediate at the storage boundary so a stale value can't leak
// into the dispatch path.
function resolveCadenceForCreate(
  action: TriggerAction,
  requested: NotificationCadence | undefined,
): NotificationCadence {
  if (!NOTIFY_TRIGGER_ACTIONS.has(action)) return "immediate";
  return requested ?? "5min_digest";
}

function resolveCadenceForUpdate(
  action: TriggerAction,
  requested: NotificationCadence | undefined,
): NotificationCadence | undefined {
  // Persist actions always pin to `immediate`. Returning `undefined`
  // here when the client omits the field would skip the column update
  // and leak a stale notify-class cadence onto a row that's been
  // edited from notify → persist (since the digest cadence stays on
  // the row but the dispatch path no longer reads it). Force the
  // boundary invariant on every update.
  if (!NOTIFY_TRIGGER_ACTIONS.has(action)) return "immediate";
  return requested;
}

const triggerIdentitySchema = z.object({
  name: z.string(),
  alertType: z.nativeEnum(AlertType).nullable().default(null),
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
 * Validates recipient addresses by RFC shape only — external addresses are
 * intentionally allowed (Slack's "email to a channel" pattern, partner
 * inboxes, …). The UI surfaces an "External" warning badge for non-team
 * addresses so operators know what they're shipping.
 *
 * A future per-project "strict mode" flag may re-enable team-membership
 * enforcement; that gate is not in this PR.
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
        notificationCadence: notificationCadenceSchema.optional(),
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
          id: true,
        },
      });

      if (!project) {
        throw new Error(`Project with id ${input.projectId} not found`);
      }

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
        // Align with `upsert` (and `validateEmailRecipientFormats`): RFC
        // shape only. External recipients are intentionally allowed; the
        // UI surfaces an "External" warning badge for any non-team
        // address so operators know what they're shipping. Two server
        // contracts for the same action would force the drawer to
        // branch on create-vs-edit, which is a footgun.
        if (input.actionParams.members && input.actionParams.members.length > 0) {
          try {
            validateEmailRecipientFormats(input.actionParams.members);
          } catch (err) {
            throw toTemplateTRPCError(err);
          }
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
          notificationCadence: resolveCadenceForCreate(
            input.action,
            input.notificationCadence,
          ),
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
  testFireTemplate: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        channel: z.enum(["email", "slack"]),
        trigger: triggerIdentitySchema,
        draft: templateDraftSchema,
        webhook: z
          .string()
          .url()
          .startsWith("https://hooks.slack.com/")
          .nullable()
          .default(null),
      }),
    )
    .use(checkProjectPermission("triggers:update"))
    .mutation(async ({ ctx, input }) => {
      // ADR-031: test fire is no longer an open relay. The client-supplied
      // recipient list is gone from the input entirely — there is nothing to
      // trust or validate. The email recipient is resolved server-side as the
      // authenticated session user. A light per-user rate limit guards the
      // mail provider against a stuck client loop (hygiene, not anti-abuse:
      // the recipient is always the requester). Slack (webhook) is unchanged
      // and intentionally exempt from the rate limit — it fires to the
      // customer's own webhook, not our mail provider.
      try {
        let recipients: string[] = [];
        if (input.channel === "email") {
          const limit = await rateLimit({
            key: `testfire:${ctx.session.user.id}`,
            windowSeconds: 60,
            max: 10,
          });
          if (!limit.allowed) {
            throw new TRPCError({
              code: "TOO_MANY_REQUESTS",
              message: buildRetryAfterMessage({
                prefix: "Too many test fires.",
                resetAt: limit.resetAt,
              }),
            });
          }

          const email = ctx.session.user.email;
          if (!email) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "Your account has no email address to send a test fire to.",
            });
          }
          recipients = [email];
        }
        const project = await resolveProjectIdentity(input.projectId);
        return await getApp().triggerTemplates.testFire({
          channel: input.channel,
          trigger: input.trigger,
          project,
          draft: input.draft,
          recipients,
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
        filters: triggerFiltersSchema,
        customGraphId: z.string().nullable().optional(),
        actionParams: actionParamsSchema,
        templates: templateDraftSchema,
        notificationCadence: notificationCadenceSchema.optional(),
        traceDebounceMs: traceDebounceMsSchema.optional(),
      }),
    )
    .use(checkProjectPermission("triggers:update"))
    .mutation(async ({ ctx, input }) => {
      try {
        validateTemplateDraft(input.templates);
        // Per-action shape validation: the provider registry's per-action
        // Zod schema is the authoritative shape for actionParams. The router's
        // top-level `actionParamsSchema` accepts the union for the wire
        // format; this pass narrows by action, so a SEND_EMAIL upsert can't
        // accidentally save a dataset config (and ADD_TO_DATASET can't
        // persist an empty datasetId, etc.).
        const perAction = actionParamsSchemaFor(input.action);
        const perActionParsed = perAction.safeParse(input.actionParams);
        if (!perActionParsed.success) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Invalid actionParams for ${input.action}: ${perActionParsed.error.errors[0]?.message ?? "validation failed"}`,
          });
        }
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

      // Annotation-queue dispatch attributes created queue items to a user
      // and skips the action when `createdByUserId` is absent. The drawer's
      // provider slice doesn't carry it, so stamp the caller here — same as
      // the legacy create mutation — or an edit would silently strip it and
      // disable dispatch for the trigger.
      const actionParams =
        input.action === TriggerAction.ADD_TO_ANNOTATION_QUEUE
          ? {
              ...input.actionParams,
              createdByUserId:
                input.actionParams.createdByUserId ?? ctx.session?.user.id,
            }
          : input.actionParams;

      const data = {
        name: input.name,
        action: input.action,
        alertType: input.alertType ?? null,
        filters: JSON.stringify(input.filters),
        customGraphId: input.customGraphId ?? null,
        actionParams,
        slackTemplateType: input.templates.slackTemplateType ?? null,
        slackTemplate: input.templates.slackTemplate ?? null,
        emailSubjectTemplate: input.templates.emailSubjectTemplate ?? null,
        emailBodyTemplate: input.templates.emailBodyTemplate ?? null,
      };

      let trigger;
      if (input.triggerId) {
        const cadenceUpdate = resolveCadenceForUpdate(
          input.action,
          input.notificationCadence,
        );
        trigger = await ctx.prisma.trigger.update({
          where: { id: input.triggerId, projectId: input.projectId },
          data: {
            ...data,
            ...(cadenceUpdate !== undefined
              ? { notificationCadence: cadenceUpdate }
              : {}),
            ...(input.traceDebounceMs !== undefined
              ? { traceDebounceMs: input.traceDebounceMs }
              : {}),
          },
        });
      } else {
        await enforceLicenseLimit(ctx, input.projectId, "automations");
        trigger = await ctx.prisma.trigger.create({
          data: {
            id: ksuid(KSUID_RESOURCES.TRIGGER).toString(),
            projectId: input.projectId,
            lastRunAt: new Date().getTime(),
            notificationCadence: resolveCadenceForCreate(
              input.action,
              input.notificationCadence,
            ),
            traceDebounceMs: input.traceDebounceMs ?? DEFAULT_TRACE_DEBOUNCE_MS,
            ...data,
          },
        });
      }

      await getApp().triggers.invalidate(input.projectId);
      return trigger;
    }),
});

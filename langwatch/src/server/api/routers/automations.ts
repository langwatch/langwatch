import { generate as ksuid } from "@langwatch/ksuid";
import { AlertType, type Prisma, TriggerAction, TriggerKind } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  DEFAULT_TRACE_DEBOUNCE_MS,
  MAX_TRACE_DEBOUNCE_MS,
  MIN_TRACE_DEBOUNCE_MS,
  NOTIFICATION_CADENCES,
  type NotificationCadence,
} from "~/automations/cadences";
import { EMAIL_RX } from "~/automations/providers/definitions/email/shared";
import { actionParamsSchemaFor } from "~/automations/providers/server";
import { getApp } from "~/server/app-layer/app";
import { DomainError } from "~/server/app-layer/domain-error";
import { translateFilterToClickHouse } from "~/server/app-layer/traces/filter-to-clickhouse";
import { listSlackChannels } from "~/server/triggers/slackWebApi";
import {
  InvalidEmailRecipientError,
  MissingAnnotatorError,
  ProjectNotFoundError,
} from "~/server/app-layer/triggers/errors";
import {
  decryptSlackBotToken,
  persistSlackActionParams,
  redactSlackActionParams,
  slackBotTokenMissing,
} from "~/automations/providers/definitions/slack/secret";
import {
  type SlackActionParams,
  slackDeliveryMethodOf,
} from "~/automations/providers/definitions/slack/shared";
import {
  buildGraphAlertTriggerData,
  type GraphAlertActionParams,
  graphAlertActionParamsSchema,
} from "~/server/app-layer/triggers/graph-alert.builder";
import {
  buildReportTriggerData,
  extractReportFromTriggerRow,
  reportActionParamsSchema,
} from "~/server/app-layer/triggers/report.builder";
import { TriggerFireHistoryService } from "~/server/app-layer/triggers/trigger-fire-history.service";
import {
  type DraftProject,
  validateTemplateDraft,
} from "~/server/app-layer/triggers/trigger-template.service";
import { NOTIFY_TRIGGER_ACTIONS } from "~/server/event-sourcing/pipelines/shared/triggerActionDispatch";
import { KSUID_RESOURCES } from "~/utils/constants";
import {
  sanitizeTriggerFilters,
  triggerFiltersPermissiveSchema,
  triggerFiltersSchema,
} from "../../filters/types";
import { enforceLicenseLimit } from "../../license-enforcement";
import { rateLimit } from "../../rateLimit";
import { checkProjectPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { extractCheckKeys } from "../utils";
import { buildRetryAfterMessage } from "./rateLimitMessage";

/** Strip the encrypted Slack bot token from a trigger row before it leaves the
 *  server — the client only needs to know a token is set (ADR-041). No-op for
 *  every non-Slack action. */
function redactTriggerForRead<
  T extends { action: TriggerAction; actionParams: unknown },
>(trigger: T): T {
  if (trigger.action !== TriggerAction.SEND_SLACK_MESSAGE) return trigger;
  return {
    ...trigger,
    actionParams: redactSlackActionParams(
      (trigger.actionParams ?? {}) as SlackActionParams,
    ),
  };
}

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

// ADR-026: cadence applies to notify actions only. New notify triggers default
// to a 5-minute digest (operator-friendly storm protection); persist actions
// are pinned to immediate at the storage boundary so a stale value can't leak
// into the dispatch path.
function resolveCadenceForCreate(
  action: TriggerAction,
  requested: NotificationCadence | undefined,
  isGraphAlert = false,
): NotificationCadence {
  if (!NOTIFY_TRIGGER_ACTIONS.has(action)) return "immediate";
  // Graph alerts are incident-based (fire on breach, silent while open,
  // resolve on recovery) — there is nothing to digest, so cadence pins to
  // immediate at the storage boundary just like persist actions.
  if (isGraphAlert) return "immediate";
  return requested ?? "5min_digest";
}

function resolveCadenceForUpdate(
  action: TriggerAction,
  requested: NotificationCadence | undefined,
  isGraphAlert = false,
): NotificationCadence | undefined {
  // Persist actions always pin to `immediate`. Returning `undefined`
  // here when the client omits the field would skip the column update
  // and leak a stale notify-class cadence onto a row that's been
  // edited from notify → persist (since the digest cadence stays on
  // the row but the dispatch path no longer reads it). Force the
  // boundary invariant on every update.
  if (!NOTIFY_TRIGGER_ACTIONS.has(action)) return "immediate";
  if (isGraphAlert) return "immediate";
  return requested;
}

const triggerIdentitySchema = z.object({
  name: z.string(),
  alertType: z.nativeEnum(AlertType).nullable().default(null),
});

const actionParamsSchema = z.object({
  // createdByUserId is server-stamped from ctx.session.user.id — the wire
  // MUST NOT carry it or a hostile client can forge audit attribution
  // (builder5015-002 / applyr-002).
  members: z.string().array().optional(),
  slackWebhook: z.string().optional(),
  // ADR-041 Slack bot delivery. `slackBotToken` arrives as plaintext (or the
  // "kept" sentinel / blank on edit) and is encrypted server-side before
  // persist; it is never returned to the client. `slackBotTokenSet` is a
  // read-only echo the client ignores on the way in.
  slackDelivery: z.enum(["webhook", "bot"]).optional(),
  slackBotToken: z.string().optional(),
  slackChannelId: z.string().optional(),
  slackBotTokenSet: z.boolean().optional(),
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
 * handling" surface (see ADR-036 follow-up).
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

async function resolveProjectIdentity(
  projectId: string,
): Promise<DraftProject> {
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
          // createdByUserId is server-stamped — do not accept from wire
          // (builder5015-002 / applyr-002).
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
        // Server-stamp the creator — the schema does not expose this to the
        // wire (builder5015-002), so we widen locally to mutate.
        (input.actionParams as Record<string, unknown>).createdByUserId =
          ctx.session?.user.id;

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
        if (
          input.actionParams.members &&
          input.actionParams.members.length > 0
        ) {
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

      // Best-effort: deactivate any scheduled-report entry for this trigger
      // (harmless no-op for non-report triggers).
      await getApp().triggers.removeReportSchedule({
        projectId: input.projectId,
        triggerId: input.triggerId,
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

      // Load the names of any custom graphs the rows point at so the
      // automations list can render "Graph: my-p95" for graph alerts
      // without a second client-side fetch per row.
      const customGraphIds = triggers
        .map((t) => t.customGraphId)
        .filter((id): id is string => typeof id === "string" && id.length > 0);
      const customGraphs =
        customGraphIds.length > 0
          ? await ctx.prisma.customGraph.findMany({
              where: { id: { in: customGraphIds }, projectId: input.projectId },
              select: { id: true, name: true },
            })
          : [];
      const customGraphsById = new Map(customGraphs.map((g) => [g.id, g]));

      const enhancedTriggers = triggers.map((trigger) => {
        let triggerFilters: Record<string, any> = {};

        if (typeof trigger.filters === "string") {
          triggerFilters = JSON.parse(trigger.filters);
        }

        const checkIds = extractCheckKeys(triggerFilters);

        const checks = checkIds.map((id) => checksMap[id]).filter(Boolean);

        const customGraph = trigger.customGraphId
          ? (customGraphsById.get(trigger.customGraphId) ?? null)
          : null;

        return {
          ...redactTriggerForRead(trigger),
          checks,
          customGraph,
        };
      });

      return enhancedTriggers;
    }),
  getTriggerStats: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("triggers:view"))
    .query(async ({ ctx, input }) => {
      const fireHistory = TriggerFireHistoryService.create(ctx.prisma);
      return fireHistory.getAllFireStatsForProject({
        projectId: input.projectId,
      });
    }),
  getRecentFires: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        triggerId: z.string(),
        limit: z.number().int().min(1).max(20).default(20),
      }),
    )
    .use(checkProjectPermission("triggers:view"))
    .query(async ({ ctx, input }) => {
      const fireHistory = TriggerFireHistoryService.create(ctx.prisma);
      return fireHistory.getAllRecentFiresForTrigger({
        projectId: input.projectId,
        triggerId: input.triggerId,
        limit: input.limit,
      });
    }),
  /** The activity feed: what every automation in the project has been doing. */
  getRecentActivity: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        limit: z.number().int().min(1).max(200).default(100),
      }),
    )
    .use(checkProjectPermission("triggers:view"))
    .query(async ({ ctx, input }) => {
      const fireHistory = TriggerFireHistoryService.create(ctx.prisma);
      return fireHistory.getAllRecentFiresForProject({
        projectId: input.projectId,
        limit: input.limit,
      });
    }),
  /**
   * When each report next runs and last ran. The cron on the trigger only
   * DESCRIBES the schedule — the scheduler owns the actual instants, so this
   * is the only honest answer to "when does this next send?".
   */
  getReportSchedules: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("triggers:view"))
    .query(async ({ input }) => {
      return getApp().triggers.getReportSchedules({
        projectId: input.projectId,
      });
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
      const existing = await ctx.prisma.trigger.findUnique({
        where: { id: input.triggerId, projectId: input.projectId },
        select: { triggerKind: true, actionParams: true },
      });
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Automation not found in this project.",
        });
      }

      // A report's schedule does not live on `Trigger.active` — it lives on the
      // scheduler. Flipping the flag alone left the `ScheduledJob` claiming its
      // slot every cadence (stamping a "last run" for a report that delivers
      // nothing) and still advertising a next run on the automations page.
      // Pausing retires the calendar entry; resuming puts it back.
      const isReport = existing.triggerKind === TriggerKind.REPORT;
      const report = isReport
        ? extractReportFromTriggerRow(existing.actionParams)
        : null;
      if (isReport && input.active && !report) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "This report has no valid schedule. Edit it and pick a schedule before resuming it.",
        });
      }

      const trigger = await ctx.prisma.trigger.update({
        where: {
          id: input.triggerId,
          projectId: input.projectId,
        },
        data: {
          active: input.active,
        },
      });

      if (isReport) {
        if (input.active && report) {
          await getApp().triggers.syncReportSchedule({
            projectId: input.projectId,
            triggerId: input.triggerId,
            cron: report.schedule.cron,
            timezone: report.schedule.timezone,
          });
        } else {
          await getApp().triggers.removeReportSchedule({
            projectId: input.projectId,
            triggerId: input.triggerId,
          });
        }
      }

      await getApp().triggers.invalidate(input.projectId);

      return trigger;
    }),
  getTriggerById: protectedProcedure
    .input(z.object({ triggerId: z.string(), projectId: z.string() }))
    .use(checkProjectPermission("triggers:view"))
    .query(async ({ ctx, input }) => {
      const trigger = await ctx.prisma.trigger.findUnique({
        where: { id: input.triggerId, projectId: input.projectId },
      });
      // Never return the encrypted bot token to the browser (ADR-041).
      return trigger ? redactTriggerForRead(trigger) : trigger;
    }),
  /**
   * List the Slack channels a bot token can see, to populate the channel
   * picker (ADR-041). Uses the freshly-typed token, or the saved automation's
   * stored token (decrypted server-side, never returned). A missing
   * `channels:read` scope comes back as `{ error: "missing_scope" }` so the UI
   * degrades to manual entry instead of failing.
   */
  listSlackChannels: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        botToken: z.string().nullable().default(null),
        automationId: z.string().optional(),
      }),
    )
    .use(checkProjectPermission("triggers:view"))
    .mutation(async ({ ctx, input }) => {
      let token = input.botToken?.trim() || null;
      if (!token && input.automationId) {
        const saved = await ctx.prisma.trigger.findUnique({
          where: { id: input.automationId, projectId: input.projectId },
          select: { actionParams: true },
        });
        token = decryptSlackBotToken(
          (saved?.actionParams ?? {}) as SlackActionParams,
        );
      }
      if (!token) return { channels: [], error: "no_token" as string };
      return listSlackChannels(token);
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
        /** Set when the Slack automation uses a bot connection. `botToken` is
         *  the freshly-typed token (fresh draft); null means "use the saved
         *  automation's stored token", resolved server-side via `automationId`. */
        botDestination: z
          .object({
            channelId: z.string(),
            botToken: z.string().nullable().default(null),
          })
          .nullable()
          .default(null),
        /** The saved automation being edited, so a kept (un-retyped) bot token
         *  can be loaded + decrypted for the test fire. */
        automationId: z.string().optional(),
        // Present when the draft is a custom-graph alert: the test message
        // then renders the alert-shaped example context + alert defaults,
        // matching what a real fire sends. Detail fields only shape the
        // example copy — they are not persisted.
        graphAlert: z
          .object({
            graphName: z.string().max(200).optional(),
            metricLabel: z.string().max(200).optional(),
            operator: z.string().max(10).optional(),
            threshold: z.number().optional(),
            timePeriodMinutes: z.number().int().positive().optional(),
          })
          .nullable()
          .default(null),
        // Present when the draft is a scheduled report: the test message then
        // renders the report example context + report defaults, the same pair a
        // scheduled fire sends. `sourceKind` picks the example data, matching
        // the drawer's own preview.
        report: z
          .object({
            sourceKind: z.enum(["traceQuery", "customGraph", "dashboard"]),
          })
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
        // Resolve the Slack bot destination: the freshly-typed token, or the
        // saved automation's stored (encrypted) token when it was kept on edit.
        let botDestination: { token: string; channel: string } | null = null;
        if (input.channel === "slack" && input.botDestination) {
          const channel = input.botDestination.channelId.trim();
          let token = input.botDestination.botToken?.trim() || null;
          if (!token && input.automationId) {
            const saved = await ctx.prisma.trigger.findUnique({
              where: { id: input.automationId, projectId: input.projectId },
              select: { actionParams: true },
            });
            token = decryptSlackBotToken(
              (saved?.actionParams ?? {}) as SlackActionParams,
            );
          }
          if (!token || !channel) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "Add a Slack bot token and channel before sending a test fire.",
            });
          }
          botDestination = { token, channel };
        }

        const project = await resolveProjectIdentity(input.projectId);
        return await getApp().triggerTemplates.testFire({
          channel: input.channel,
          trigger: input.trigger,
          project,
          draft: input.draft,
          recipients,
          webhook: input.webhook,
          botDestination,
          graphAlert: input.graphAlert,
          report: input.report,
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
        /** ADR-043 Subject facet: the Traces-V2 liqe query the automation is
         *  about. When set, it supersedes `filters` (persisted as `{}`) and the
         *  dispatcher evaluates it in-memory. Trace-subject automations, plus
         *  trace-query REPORTS — where it scopes the traces the report sends. */
        filterQuery: z.string().nullable().optional(),
        customGraphId: z.string().nullable().optional(),
        /** Graph-threshold-alert rule. Present iff this is a graph alert
         *  (`customGraphId` set); merged into `actionParams` before persist
         *  so the dispatcher (cron + event-sourced) reads one shape. */
        graphAlert: graphAlertActionParamsSchema.optional(),
        /** Scheduled-report shape (source + schedule). Present iff this is a
         *  REPORT; mutually exclusive with graphAlert. */
        report: reportActionParamsSchema.optional(),
        actionParams: actionParamsSchema,
        templates: templateDraftSchema,
        notificationCadence: notificationCadenceSchema.optional(),
        traceDebounceMs: traceDebounceMsSchema.optional(),
      }),
    )
    .use(checkProjectPermission("triggers:update"))
    .mutation(async ({ ctx, input }) => {
      const isGraphAlert = !!input.customGraphId;
      const isReport = !isGraphAlert && !!input.report;
      try {
        validateTemplateDraft(input.templates);
        if (isGraphAlert) {
          // Graph alerts only support notify channels — there is no
          // "ADD_TO_DATASET on a metric crossing a threshold" UX.
          if (
            input.action !== TriggerAction.SEND_EMAIL &&
            input.action !== TriggerAction.SEND_SLACK_MESSAGE
          ) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "Graph alerts only support Email or Slack notifications.",
            });
          }
          if (!input.graphAlert) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "Graph alerts require a threshold rule (operator, threshold, time period, series).",
            });
          }
          if (!input.alertType) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Graph alerts require an alert severity.",
            });
          }
          // The graph must belong to the calling project — multitenancy
          // gate. Without this a hostile client could attach a trigger to
          // a graph from another tenant.
          const graph = await ctx.prisma.customGraph.findUnique({
            where: {
              id: input.customGraphId ?? "",
              projectId: input.projectId,
            },
            select: { id: true },
          });
          if (!graph) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Graph not found in this project.",
            });
          }
        }
        if (isReport) {
          // A report sends a rendered notification on a schedule — notify
          // channels only, like alerts.
          if (
            input.action !== TriggerAction.SEND_EMAIL &&
            input.action !== TriggerAction.SEND_SLACK_MESSAGE
          ) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Reports can only send Email or Slack notifications.",
            });
          }
        }
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
        // Slack webhook / bot-channel presence is enforced by the per-action
        // schema's superRefine above. The bot-token presence check (which must
        // allow "kept" on edit) runs after this block — it needs the saved row.
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

      // ADR-043 Subject facet: normalise + validate the trace-filter query
      // before persisting. Empty/whitespace collapses to null (the legacy
      // `filters` path). A non-empty query is dry-run through the compiler so a
      // malformed query is rejected here with author feedback rather than
      // silently failing closed (matching nothing) at dispatch time.
      const filterQuery =
        input.filterQuery && input.filterQuery.trim() !== ""
          ? input.filterQuery.trim()
          : null;
      if (filterQuery !== null) {
        try {
          translateFilterToClickHouse(filterQuery, input.projectId, {
            from: 0,
            to: 0,
          });
        } catch (err) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Invalid trace filter: ${
              err instanceof Error ? err.message : "could not parse the query"
            }`,
          });
        }
      }

      // ADR-041 Slack bot delivery: encrypt a freshly-entered bot token (or
      // keep the stored ciphertext when the field was left blank on edit), and
      // reject a bot connection saved with no token at all. The token is never
      // returned to the client, so honouring "kept" means reading the saved row.
      let slackActionParams: SlackActionParams | null = null;
      if (input.action === TriggerAction.SEND_SLACK_MESSAGE) {
        const incoming = input.actionParams as SlackActionParams;
        const existing =
          input.triggerId && slackDeliveryMethodOf(incoming) === "bot"
            ? ((
                await ctx.prisma.trigger.findUnique({
                  where: { id: input.triggerId, projectId: input.projectId },
                  select: { actionParams: true },
                })
              )?.actionParams as SlackActionParams | undefined)
            : undefined;
        if (slackBotTokenMissing({ incoming, existing })) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "A Slack bot token is required for a bot connection.",
          });
        }
        slackActionParams = persistSlackActionParams({ incoming, existing });
      }

      // Annotation-queue dispatch attributes created queue items to a user
      // and skips the action when `createdByUserId` is absent. The drawer's
      // provider slice doesn't carry it, so stamp the caller here — same as
      // the legacy create mutation — or an edit would silently strip it and
      // disable dispatch for the trigger.
      // Force createdByUserId to the session user — never trust the client
      // (builder5015-002). The schema strips it from the wire; we stamp
      // unconditionally on the annotation-queue branch below.
      let actionParams: Record<string, unknown> =
        input.action === TriggerAction.ADD_TO_ANNOTATION_QUEUE
          ? {
              ...input.actionParams,
              createdByUserId: ctx.session?.user.id,
            }
          : slackActionParams
            ? { ...slackActionParams }
            : { ...input.actionParams };

      // Graph alerts: route the row shape through the SSOT builder so it's
      // byte-identical to what `graphs.updateById` writes on the dashboard
      // path (N1 — the sweep fixed graphs.ts but automations.ts was still
      // hand-rolling the row). The dispatcher only knows one shape; drift
      // between the two writers silently breaks dispatch for whichever
      // format loses.
      let data: Omit<Prisma.TriggerUncheckedCreateInput, "projectId">;
      if (isGraphAlert && input.graphAlert && input.customGraphId) {
        const graphAlert: GraphAlertActionParams = input.graphAlert;
        const builderInput = {
          id: input.triggerId ?? ksuid(KSUID_RESOURCES.TRIGGER).toString(),
          name: input.name,
          projectId: input.projectId,
          action: input.action,
          alertType: input.alertType ?? AlertType.INFO,
          customGraphId: input.customGraphId,
          actionParams: {
            ...actionParams,
            ...graphAlert,
          },
        };
        const built = buildGraphAlertTriggerData(builderInput);
        data = {
          name: built.name,
          action: built.action,
          triggerKind: TriggerKind.ALERT,
          alertType: built.alertType,
          filters: built.filters,
          // Graph alerts never carry a trace-filter query; clear it so a kind
          // conversion can't leave a stale one behind.
          filterQuery: null,
          customGraphId: built.customGraphId,
          actionParams: built.actionParams,
          slackTemplateType: input.templates.slackTemplateType ?? null,
          slackTemplate: input.templates.slackTemplate ?? null,
          emailSubjectTemplate: input.templates.emailSubjectTemplate ?? null,
          emailBodyTemplate: input.templates.emailBodyTemplate ?? null,
        };
      } else if (isReport && input.report) {
        const built = buildReportTriggerData({
          id: input.triggerId ?? ksuid(KSUID_RESOURCES.TRIGGER).toString(),
          name: input.name,
          projectId: input.projectId,
          action: input.action,
          actionParams: { ...actionParams, ...input.report },
        });
        data = {
          name: built.name,
          action: built.action,
          triggerKind: TriggerKind.REPORT,
          filters: built.filters,
          // Converting an existing graph alert into a report must release the
          // graph: a left-behind `customGraphId` re-arms the row as a threshold
          // alert on the heartbeat path, so the report fires as an alert too.
          customGraphId: null,
          // A trace-query report sends the traces matching the author's Subject
          // query — without this the report would only ever send the newest
          // traces in the window. A graph/dashboard report has no trace query,
          // so the column is cleared (a source change can't strand a stale one).
          filterQuery:
            input.report.source.kind === "traceQuery" ? filterQuery : null,
          actionParams: built.actionParams,
          slackTemplateType: input.templates.slackTemplateType ?? null,
          slackTemplate: input.templates.slackTemplate ?? null,
          emailSubjectTemplate: input.templates.emailSubjectTemplate ?? null,
          emailBodyTemplate: input.templates.emailBodyTemplate ?? null,
        };
      } else {
        data = {
          name: input.name,
          action: input.action,
          triggerKind: TriggerKind.AUTOMATION,
          alertType: input.alertType ?? null,
          // A trace-subject automation supersedes the structured `filters` with
          // its liqe query; persist an empty `{}` so the legacy matcher is a
          // no-op and the dispatcher reads `filterQuery` instead.
          filters: filterQuery !== null ? "{}" : JSON.stringify(input.filters),
          filterQuery,
          customGraphId: input.customGraphId ?? null,
          actionParams: actionParams as Prisma.InputJsonValue,
          slackTemplateType: input.templates.slackTemplateType ?? null,
          slackTemplate: input.templates.slackTemplate ?? null,
          emailSubjectTemplate: input.templates.emailSubjectTemplate ?? null,
          emailBodyTemplate: input.templates.emailBodyTemplate ?? null,
        };
      }

      let trigger;
      if (input.triggerId) {
        const cadenceUpdate = resolveCadenceForUpdate(
          input.action,
          input.notificationCadence,
          isGraphAlert,
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
        // A graph alert owns its custom-graph's unique `customGraphId` slot.
        // `deleteById` soft-deletes (keeps the row and its @unique
        // customGraphId occupied), so a fresh `create` for a graph that ever
        // had an alert would violate the unique index — an unhandled P2002 →
        // 500, with no UI path to recover since the soft-deleted row is hidden.
        // Reactivate the existing row instead, matching the legacy
        // graphs.updateById upsert-by-customGraphId behaviour.
        const existingForGraph =
          isGraphAlert && input.customGraphId
            ? await ctx.prisma.trigger.findFirst({
                where: {
                  projectId: input.projectId,
                  customGraphId: input.customGraphId,
                },
              })
            : null;
        if (existingForGraph) {
          trigger = await ctx.prisma.trigger.update({
            where: { id: existingForGraph.id, projectId: input.projectId },
            data: {
              ...data,
              deleted: false,
              active: true,
              lastRunAt: new Date().getTime(),
              notificationCadence: resolveCadenceForCreate(
                input.action,
                input.notificationCadence,
                isGraphAlert,
              ),
              traceDebounceMs:
                input.traceDebounceMs ?? DEFAULT_TRACE_DEBOUNCE_MS,
            },
          });
        } else {
          trigger = await ctx.prisma.trigger.create({
            data: {
              id: ksuid(KSUID_RESOURCES.TRIGGER).toString(),
              projectId: input.projectId,
              lastRunAt: new Date().getTime(),
              notificationCadence: resolveCadenceForCreate(
                input.action,
                input.notificationCadence,
                isGraphAlert,
              ),
              traceDebounceMs:
                input.traceDebounceMs ?? DEFAULT_TRACE_DEBOUNCE_MS,
              ...data,
            },
          });
        }
      }

      if (isReport && input.report) {
        // Wire the report onto the calendar scheduler (ADR-042): its trigger
        // id is the scheduler targetId; publishWake nudges every pod's loop.
        await getApp().triggers.syncReportSchedule({
          projectId: input.projectId,
          triggerId: trigger.id,
          cron: input.report.schedule.cron,
          timezone: input.report.schedule.timezone,
        });
      }

      await getApp().triggers.invalidate(input.projectId);
      return trigger;
    }),
});

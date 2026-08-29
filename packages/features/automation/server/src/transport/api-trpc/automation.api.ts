/**
 * The automation authoring and activity surface over the process's tRPC
 * transport.
 *
 * Transport only: gates, input parsing, the shape rules an author's draft has
 * to satisfy, and delegation to the canonical `AutomationService`. Everything
 * that needs a secret, a Redis round trip or the trace query compiler arrives
 * as a port, because none of those are automation's to own.
 *
 * Two rules on this surface are load-bearing and easy to lose in a move:
 *
 *   - Secrets never travel outwards. `redactTriggerForRead` runs the provider
 *     registry's redact hook over every row that leaves — the encrypted Slack
 *     bot token (ADR-041) and webhook header values (ADR-040 §3).
 *   - A test fire is not an open relay (ADR-031). The email recipient is the
 *     authenticated session user, resolved here and never taken from the wire.
 *
 * Spec: ADR-026, ADR-031, ADR-040, ADR-041, ADR-043, ADR-044.
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  automationApiCreateInputSchema,
  automationApiListSlackChannelsInputSchema,
  automationApiProjectScopeSchema,
  automationApiRecentActivityInputSchema,
  automationApiRecentFiresInputSchema,
  automationApiTestFireInputSchema,
  automationApiToggleTriggerInputSchema,
  automationApiTriggerScopeSchema,
  automationApiUpdateTriggerFiltersInputSchema,
  automationApiUpsertInputSchema,
  automationApiWebhookDeliveriesInputSchema,
  automationFilterFieldSchema,
  buildGraphAlertTriggerData,
  type BuildGraphAlertTriggerDataInput,
  buildReportTriggerData,
  DEFAULT_TRACE_DEBOUNCE_MS,
  EMAIL_RX,
  extractReportFromTriggerRow,
  hasActionableTriggerFilters,
  InvalidActionParamsError,
  InvalidEmailRecipientError,
  MissingAnnotatorError,
  MissingSlackWebhookError,
  NOTIFY_TRIGGER_ACTIONS,
  NotificationDeliveryError,
  TestFireUnavailableError,
  TriggerAction,
  TriggerActionUnsupportedError,
  TriggerFiltersRequiredError,
  WEBHOOK_HEADER_VALUE_KEPT,
  type AutomationAction,
  type AutomationFilters,
  type CreateTriggerCommand,
  type GraphAlertActionParams,
  type NotificationCadence,
  type TestFireWebhookDestination,
} from "@langwatch/automation-contract";
import { isDispatchError } from "@langwatch/eventing";
import { HandledError } from "@langwatch/handled-error";
import { generate as ksuid } from "@langwatch/ksuid";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";
import type { SlackChannelListing } from "../../adapters/slack-web-api.delivery.adapter";
import type { AutomationWebhookStoredParams } from "../../ports/automation-provider.port";
import {
  AutomationFiltersUnsupportedError,
  AutomationTraceFilterInvalidError,
  AutomationWebhookUpsertRequiredError,
  GraphAlertChannelUnsupportedError,
  GraphAlertSeverityRequiredError,
  GraphAlertThresholdRequiredError,
  ReportChannelUnsupportedError,
  ReportScheduleMissingError,
  TestFireRateLimitedError,
  type AutomationApp,
} from "#app/automation.app";
import { buildRetryAfterMessage } from "./retry-after-message";

/**
 * The app's KSUID resource for a trigger row (`KSUID_RESOURCES.TRIGGER`). The
 * literal rather than the app's constant table: the prefix is part of the id
 * format already written to the database, so it belongs with the writer.
 */
const TRIGGER_KSUID_RESOURCE = "trigger";

/**
 * The process supplies authentication; authorization arrives as `policy`.
 *
 * `app` is the slice of the process's application this feature reaches, not
 * the feature's application itself, because a tRPC root is shared by every
 * feature mounted on it and so carries all of them. The REST family, which is
 * built per family, holds {@link AutomationApp} directly. Both reach the same
 * object; only the path to it differs.
 *
 * `session` rather than `actor()` alone: the test fire resolves its recipient
 * from the caller's own email address, which is the whole of ADR-031's
 * open-relay fix.
 */
export type AutomationTrpcContext = Readonly<{
  app: Readonly<{ automation: AutomationApp }>;
  actor(): Readonly<{ id: string }>;
  session: Readonly<{ user: Readonly<{ email?: string | null }> }> | null;
}>;

type AutomationTrpcProcedures<
  TContext extends AutomationTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The process's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /**
   * The process's tracing, logging, error, scope-lineage, authorization and
   * audit policy for one declared permission.
   *
   * Applied by this feature AFTER its own input parser rather than composed
   * ahead of it, because the authorization check reads its scope id from the
   * validated input: tRPC runs middlewares in the order they were added, so a
   * check installed before `.input()` would see no input at all.
   */
  policy(permission: AuthzPermission): <TProcedure>(procedure: TProcedure) => TProcedure;
}>;

/**
 * One `safeParse` outcome, described structurally rather than as a Zod type:
 * the schema comes from the process's provider registry, which is compiled
 * against its own copy of Zod.
 */
type ActionParamsParseResult =
  | Readonly<{ success: true; data: unknown }>
  | Readonly<{
      success: false;
      error: Readonly<{ issues: readonly Readonly<{ message: string }>[] }>;
    }>;

/** The per-action `actionParams` parser the process's provider registry owns. */
type ActionParamsSchema = Readonly<{
  safeParse(value: unknown): ActionParamsParseResult;
}>;

/**
 * The process capabilities this transport needs that automation does not own.
 *
 * Every provider entry reaches the process's secret handling: the encryption
 * key is the deployment's, not the feature's, so encrypting, redacting and
 * resolving a kept sentinel all stay on the process side of the seam.
 */
export type AutomationTrpcPorts = Readonly<{
  /**
   * The process's per-key fixed-window limiter. Hygiene on the test-fire
   * button, and the outbound-flood cap on the webhook channel (ADR-040 §4).
   */
  rateLimit(input: {
    key: string;
    windowSeconds: number;
    max: number;
  }): Promise<Readonly<{ allowed: boolean; resetAt: number }>>;
  providers: Readonly<{
    /** The authoritative `actionParams` shape for one action. */
    actionParamsSchemaFor(action: AutomationAction): ActionParamsSchema;
    /**
     * Wire params in their at-rest shape: secrets encrypted, kept sentinels
     * resolved against the saved row. Throws `HandledError` subclasses for the
     * author-facing failures.
     */
    persistActionParamsFor(
      action: AutomationAction,
      args: Readonly<{
        incoming: Record<string, unknown>;
        loadExisting: () => Promise<unknown>;
      }>,
    ): Promise<unknown>;
    /** Stored params with every secret stripped, for a row on its way out. */
    redactActionParamsFor(action: AutomationAction, params: unknown): unknown;
    /** The stored Slack bot token in the clear, or null when none is stored. */
    decryptSlackBotToken(actionParams: unknown): string | null;
    /** The stored webhook header values in the clear, by header name. */
    decryptWebhookHeaders(stored: AutomationWebhookStoredParams): Record<string, string>;
    /** The stored webhook signing secrets in the clear, newest first. */
    decryptWebhookSigningSecrets(stored: AutomationWebhookStoredParams): readonly string[];
  }>;
  /**
   * The Slack channels a bot token can see, through the process's own
   * SSRF-checked HTTP client.
   */
  listSlackChannels(token: string): Promise<SlackChannelListing>;
  /**
   * Compiles a trace-filter query, throwing when it cannot be parsed. A dry
   * run: an unparseable query is rejected with author feedback here rather
   * than failing closed (matching nothing) at dispatch time.
   */
  assertTraceFilterQueryCompiles(input: Readonly<{ query: string; projectId: string }>): void;
}>;

/**
 * Re-raises a thrown value on the typed channel, and never returns.
 *
 * A `HandledError` is already on that channel and leaves untouched: the
 * process's tRPC policy maps its status to a code and its `serialize()` to
 * `data.error`, which is the whole reason this transport no longer builds a
 * `TRPCError` itself.
 *
 * A provider rejection (Slack `not_in_channel`, a dead webhook, a bad token)
 * arrives as a `DispatchError` with an already-actionable message, so it is
 * lifted onto the typed channel here rather than reaching the customer as a
 * generic 500.
 *
 * Anything else is re-raised exactly as it arrived. That is deliberate: an
 * unanticipated failure degrades to "unknown" plus a trace id at the boundary
 * (ADR-045), and dressing it up as handled would promise the caller an action
 * they do not have.
 */
/**
 * The action a graph alert or a report may carry, or a refusal.
 *
 * Both kinds deliver a notification and have nowhere to put a row, which is
 * what their builders' input types have always said. The door did not enforce
 * it: a graph alert asking to add to a dataset was stored with that action and
 * then never delivered, because the dispatcher has no such path for it.
 */
function notifyingActionOr(
  action: BuildGraphAlertTriggerDataInput["action"] | "ADD_TO_DATASET" | "ADD_TO_ANNOTATION_QUEUE",
  triggerKind: "graph alert" | "report",
): BuildGraphAlertTriggerDataInput["action"] {
  if (action === "ADD_TO_DATASET" || action === "ADD_TO_ANNOTATION_QUEUE") {
    throw new TriggerActionUnsupportedError(triggerKind, action);
  }
  return action;
}

function raiseAsHandled(err: unknown): never {
  if (HandledError.isHandled(err)) throw err;
  if (isDispatchError(err)) {
    throw new NotificationDeliveryError(err.message, {
      customerMessage: err.customerMessage,
    });
  }
  throw err;
}

/**
 * The monitor ids a filter set names.
 *
 * A filter object nests, and the ids sit on the keys rather than the values,
 * so the whole structure is walked. Arrays are left alone: their entries are
 * selected values, never further filter fields.
 */
function extractCheckKeys(inputObject: Record<string, unknown>): string[] {
  const keys: string[] = [];

  const recurse = (obj: Record<string, unknown>) => {
    for (const key of Object.keys(obj)) {
      if (key.startsWith("check_") || key.startsWith("eval_") || key.startsWith("evaluation_")) {
        keys.push(key);
      }
      const value = obj[key];
      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        recurse(value as Record<string, unknown>);
      }
    }
  };

  recurse(inputObject);
  return keys;
}

const KNOWN_FILTER_FIELDS = new Set<string>(automationFilterFieldSchema.options);

/**
 * Splits an author's filter set into the fields this platform still supports
 * and the ones it no longer does.
 *
 * The unknown names are kept rather than dropped silently: an automation whose
 * every condition is legacy would otherwise save as "matches everything".
 */
function partitionFilterFields(filters: Record<string, unknown>): {
  sanitized: AutomationFilters;
  unknownFields: string[];
} {
  const sanitized: Record<string, unknown> = {};
  const unknownFields: string[] = [];

  for (const [key, value] of Object.entries(filters)) {
    if (KNOWN_FILTER_FIELDS.has(key)) {
      sanitized[key] = value;
    } else {
      unknownFields.push(key);
    }
  }

  return { sanitized: sanitized as AutomationFilters, unknownFields };
}

// ADR-026: cadence applies to notify actions only. New notify triggers default
// to a 5-minute digest (operator-friendly storm protection); persist actions
// are pinned to immediate at the storage boundary so a stale value can't leak
// into the dispatch path.
function resolveCadenceForCreate(
  action: AutomationAction,
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
  action: AutomationAction,
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

/**
 * Validates recipient addresses by RFC shape only — external addresses are
 * intentionally allowed (Slack's "email to a channel" pattern, partner
 * inboxes, …). The UI surfaces an "External" warning badge for non-team
 * addresses so operators know what they're shipping.
 *
 * A future per-project "strict mode" flag may re-enable team-membership
 * enforcement.
 */
function validateEmailRecipientFormats(recipients: string[]): void {
  for (const email of recipients) {
    if (!EMAIL_RX.test(email)) {
      throw new InvalidEmailRecipientError(email);
    }
  }
}

/** Installs the complete `automation.*` tRPC surface on a process-owned root. */
export class AutomationTrpcApi {
  static create<
    TContext extends AutomationTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: AutomationTrpcProcedures<TContext, TOptions, TRoot>,
    ports: AutomationTrpcPorts,
  ) {
    const { protected: procedure, policy } = procedures;

    /** Strip secrets from a trigger row before it leaves the server via the
     *  provider registry's redact hook: the encrypted Slack bot token (ADR-041)
     *  and webhook header values (ADR-040 §3 — names echo with the kept
     *  sentinel, values never return). Identity for every other action. */
    const redactTriggerForRead = <T extends { action: AutomationAction; actionParams: unknown }>(
      trigger: T,
    ): T => ({
      ...trigger,
      actionParams: ports.providers.redactActionParamsFor(
        trigger.action,
        trigger.actionParams ?? {},
      ),
    });

    return trpc.router({
      create: policy("triggers:create")(procedure.input(automationApiCreateInputSchema)).mutation(
        async ({ ctx, input }) => {
          // This legacy mutation cannot carry the validated/encrypted webhook
          // destination shape. Never let a direct caller create a malformed or
          // feature-flag-bypassing SEND_WEBHOOK row; the provider-aware upsert is
          // the sole webhook writer.
          if (input.action === TriggerAction.SEND_WEBHOOK) {
            throw new AutomationWebhookUpsertRequiredError();
          }

          // This path only ever writes AUTOMATION rows (it carries no graph or
          // report shape), so the condition is always required here. The rule
          // lives on the application, which the REST family reaches too.
          ctx.app.automation.assertTraceConditionPresent(input.filters);

          await ctx.app.automation.getProjectIdentity(input.projectId);

          if (input.action === TriggerAction.ADD_TO_ANNOTATION_QUEUE) {
            // Server-stamp the creator — the schema does not expose this to the
            // wire (builder5015-002), so we widen locally to mutate.
            (input.actionParams as Record<string, unknown>).createdByUserId = ctx.actor().id;

            if (!input.actionParams.annotators) {
              throw new MissingAnnotatorError();
            }
          }

          if (input.action === TriggerAction.SEND_SLACK_MESSAGE) {
            if (!input.actionParams.slackWebhook) {
              throw new MissingSlackWebhookError();
            }
          } else if (input.action === TriggerAction.SEND_EMAIL) {
            // Align with `upsert` (and `validateEmailRecipientFormats`): RFC
            // shape only. External recipients are intentionally allowed; the
            // UI surfaces an "External" warning badge for any non-team
            // address so operators know what they're shipping. Two server
            // contracts for the same action would force the drawer to
            // branch on create-vs-edit, which is a footgun.
            if (input.actionParams.members && input.actionParams.members.length > 0) {
              validateEmailRecipientFormats(input.actionParams.members);
            }
          }

          const trigger = await ctx.app.automation.create({
            id: ksuid(TRIGGER_KSUID_RESOURCE).toString(),
            name: input.name,
            action: input.action,
            actionParams: input.actionParams,
            filters: input.filters,
            projectId: input.projectId,
            lastRunAt: new Date(),
            notificationCadence: resolveCadenceForCreate(input.action, input.notificationCadence),
          });

          return redactTriggerForRead(trigger);
        },
      ),

      /**
       * Removal is one operation on the application: the soft delete, the
       * retirement of any scheduled-report entry, and the dispatch-cache
       * invalidation. Doing it in three calls here left the REST family free to
       * do two of the three, which is exactly what it did.
       */
      deleteById: policy("triggers:delete")(
        procedure.input(automationApiTriggerScopeSchema),
      ).mutation(async ({ input, ctx }) => {
        await ctx.app.automation.delete({
          triggerId: input.triggerId,
          projectId: input.projectId,
        });

        return { success: true };
      }),

      getTriggers: policy("triggers:view")(procedure.input(automationApiProjectScopeSchema)).query(
        async ({ ctx, input }) => {
          const triggers = await ctx.app.automation.getAllForProject({
            projectId: input.projectId,
          });

          const allCheckIds = triggers.flatMap((trigger) => extractCheckKeys(trigger.filters));

          const allChecks = await ctx.app.automation.getMonitorsByIds({
            monitorIds: allCheckIds,
            projectId: input.projectId,
          });

          const checksMap = allChecks.reduce<Record<string, (typeof allChecks)[number]>>(
            (map, check) => {
              map[check.id] = check;
              return map;
            },
            {},
          );

          // Load the names of any custom graphs the rows point at so the
          // automations list can render "Graph: my-p95" for graph alerts
          // without a second client-side fetch per row.
          const customGraphIds = triggers
            .map((t) => t.customGraphId)
            .filter((id): id is string => typeof id === "string" && id.length > 0);
          const customGraphs =
            customGraphIds.length > 0
              ? await ctx.app.automation.getCustomGraphNamesByIds({
                  customGraphIds,
                  projectId: input.projectId,
                })
              : [];
          const customGraphsById = new Map(customGraphs.map((g) => [g.id, g]));

          const enhancedTriggers = triggers.map((trigger) => {
            const checkIds = extractCheckKeys(trigger.filters);

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
        },
      ),

      /**
       * The plan's daily ceiling on persist actions, on its own. The authoring
       * drawer only advises against the ceiling and never reads a count, so it
       * takes this rather than the status below and skips a scan it would discard.
       */
      getDailyCap: policy("triggers:view")(procedure.input(automationApiProjectScopeSchema)).query(
        async ({ ctx, input }) => ({
          cap: await ctx.app.automation.resolvePersistDailyCap(input.projectId),
        }),
      ),

      /**
       * Today's confirmed-match count and skipped count per automation, so the
       * list can say "N matches skipped today" instead of leaving the customer to
       * wonder why an automation they can see running produced nothing. A Redis
       * outage degrades to showing no skips rather than failing the page.
       *
       * The automations it covers are read here rather than taken from the caller.
       * The page renders every automation in the project, so a caller-supplied list
       * either has to be unbounded, which puts the read's size in the caller's
       * hands, or capped, which silently drops the badge from every automation past
       * the cap. Reading the ids here bounds the work by what the project actually
       * owns, which is the same set the page is already rendering.
       */
      getDailyCapStatus: policy("triggers:view")(
        procedure.input(automationApiProjectScopeSchema),
      ).query(async ({ ctx, input }) => {
        const cap = await ctx.app.automation.resolvePersistDailyCap(input.projectId);
        const triggers = await ctx.app.automation.getAllForProject({
          projectId: input.projectId,
        });
        const counts = await ctx.app.automation.readPersistCapCounts({
          projectId: input.projectId,
          triggerIds: triggers.map((trigger) => trigger.id),
          now: new Date(),
          cap,
        });
        return { cap, counts };
      }),

      getTriggerStats: policy("triggers:view")(
        procedure.input(automationApiProjectScopeSchema),
      ).query(async ({ ctx, input }) => {
        return ctx.app.automation.getFireStats({
          projectId: input.projectId,
        });
      }),

      getRecentFires: policy("triggers:view")(
        procedure.input(automationApiRecentFiresInputSchema),
      ).query(async ({ ctx, input }) => {
        return ctx.app.automation.getRecentFires({
          projectId: input.projectId,
          triggerId: input.triggerId,
          limit: input.limit,
        });
      }),

      /** ADR-040 §6: the per-attempt webhook delivery log for one automation —
       *  the drawer's "Recent deliveries" drill-down. Header values are already
       *  redacted at write time. */
      getWebhookDeliveries: policy("triggers:view")(
        procedure.input(automationApiWebhookDeliveriesInputSchema),
      ).query(async ({ ctx, input }) => {
        return ctx.app.automation.getRecentWebhookDeliveries({
          projectId: input.projectId,
          triggerId: input.triggerId,
          limit: input.limit,
        });
      }),

      /** The activity feed: what every automation in the project has been doing. */
      getRecentActivity: policy("triggers:view")(
        procedure.input(automationApiRecentActivityInputSchema),
      ).query(async ({ ctx, input }) => {
        return ctx.app.automation.getRecentFires({
          projectId: input.projectId,
          limit: input.limit,
        });
      }),

      /**
       * When each report next runs and last ran. The cron on the trigger only
       * DESCRIBES the schedule — the scheduler owns the actual instants, so this
       * is the only honest answer to "when does this next send?".
       */
      getReportSchedules: policy("triggers:view")(
        procedure.input(automationApiProjectScopeSchema),
      ).query(async ({ input, ctx }) => {
        return ctx.app.automation.getReportSchedules({
          projectId: input.projectId,
        });
      }),

      toggleTrigger: policy("triggers:update")(
        procedure.input(automationApiToggleTriggerInputSchema),
      ).mutation(async ({ input, ctx }) => {
        const existing = await ctx.app.automation.requireById({
          triggerId: input.triggerId,
          projectId: input.projectId,
        });

        // A report's schedule does not live on `Trigger.active` — it lives on the
        // scheduler. Flipping the flag alone left the `ScheduledJob` claiming its
        // slot every cadence (stamping a "last run" for a report that delivers
        // nothing) and still advertising a next run on the automations page.
        // Pausing retires the calendar entry; resuming puts it back.
        const isReport = existing.triggerKind === "REPORT";
        const report = isReport ? extractReportFromTriggerRow(existing.actionParams) : null;
        if (isReport && input.active && !report) {
          throw new ReportScheduleMissingError();
        }

        const trigger = await ctx.app.automation.update({
          id: input.triggerId,
          projectId: input.projectId,
          active: input.active,
          // Resuming clears the platform's pause record. Leaving it behind
          // would make a running automation keep claiming it was paused for
          // runaway volume, and the next genuine pause would be
          // indistinguishable from the stale one.
          ...(input.active ? { pausedReason: null, pausedAt: null } : {}),
        });

        if (isReport) {
          if (input.active && report) {
            await ctx.app.automation.syncReportSchedule({
              projectId: input.projectId,
              triggerId: input.triggerId,
              cron: report.schedule.cron,
              timezone: report.schedule.timezone,
            });
          } else {
            await ctx.app.automation.removeReportSchedule({
              projectId: input.projectId,
              triggerId: input.triggerId,
            });
          }
        }

        return redactTriggerForRead(trigger);
      }),

      getTriggerById: policy("triggers:view")(
        procedure.input(automationApiTriggerScopeSchema),
      ).query(async ({ input, ctx }) => {
        const trigger = await ctx.app.automation.tryGetById({
          triggerId: input.triggerId,
          projectId: input.projectId,
        });
        // Never return the encrypted bot token to the browser (ADR-041).
        return trigger ? redactTriggerForRead(trigger) : trigger;
      }),

      /**
       * List the Slack channels a bot token can see, to populate the channel
       * picker (ADR-041). Uses the freshly-typed token, or the saved automation's
       * stored token (decrypted server-side, never returned). A missing
       * `channels:read` scope comes back as `{ error: "missing_scope" }` so the UI
       * degrades to manual entry instead of failing. A listing that succeeded but
       * does not cover the whole workspace carries `gaps` saying why, so the picker
       * can tell the author rather than presenting a short list as complete.
       *
       * triggers:update (not :view): this endpoint decrypts and exercises the
       * stored Slack bot token — the same capability testFireTemplate gates on.
       */
      listSlackChannels: policy("triggers:update")(
        procedure.input(automationApiListSlackChannelsInputSchema),
      ).mutation(async ({ input, ctx }) => {
        let token = input.botToken?.trim() || null;
        if (!token && input.automationId) {
          const saved = await ctx.app.automation.tryGetById({
            triggerId: input.automationId,
            projectId: input.projectId,
          });
          token = ports.providers.decryptSlackBotToken(saved?.actionParams ?? {});
        }
        if (!token) return { channels: [], error: "no_token" as string, gaps: [] };
        return ports.listSlackChannels(token);
      }),

      updateTriggerFilters: policy("triggers:update")(
        procedure.input(automationApiUpdateTriggerFiltersInputSchema),
      ).mutation(async ({ ctx, input }) => {
        const { sanitized, unknownFields } = partitionFilterFields(input.filters);

        if (unknownFields.length > 0 && Object.keys(sanitized).length === 0) {
          throw new AutomationFiltersUnsupportedError(unknownFields);
        }

        // Editing is the other way to end up with a match-everything automation:
        // create it with a real condition, then clear it here. The rule — which
        // the REST family enforces too — is the application's.
        if (!hasActionableTriggerFilters(sanitized)) {
          const existing = await ctx.app.automation.requireById({
            triggerId: input.triggerId,
            projectId: input.projectId,
          });
          ctx.app.automation.assertConditionSurvivesEdit({ existing, filters: sanitized });
        }

        const trigger = await ctx.app.automation.update({
          id: input.triggerId,
          projectId: input.projectId,
          filters: sanitized,
        });

        return redactTriggerForRead(trigger);
      }),

      testFireTemplate: policy("triggers:update")(
        procedure.input(automationApiTestFireInputSchema),
      ).mutation(async ({ ctx, input }) => {
        // ADR-031: test fire is no longer an open relay. The client-supplied
        // recipient list is gone from the input entirely — there is nothing to
        // trust or validate. The email recipient is resolved server-side as the
        // authenticated session user. A light per-user rate limit guards the
        // mail provider against a stuck client loop (hygiene, not anti-abuse:
        // the recipient is always the requester). Slack (webhook) is unchanged
        // and intentionally exempt from the rate limit — it fires to the
        // customer's own webhook, not our mail provider.
        try {
          // The webhook channel ships dark (ADR-040 §7): the type picker is
          // flag-gated client-side, and the server refuses the channel too so
          // the flag can't be bypassed by calling the API directly.
          if (input.channel === "webhook") {
            await ctx.app.automation.assertWebhookChannelEnabled({
              projectId: input.projectId,
              userId: ctx.actor().id,
            });
          }
          // Email shares the mail provider; webhook fires at an ARBITRARY
          // customer URL from our worker IPs, so an uncapped test button would
          // be an outbound request-flood primitive (ADR-040 §4). Slack stays
          // exempt: its destination is host-pinned to hooks.slack.com.
          if (input.channel === "email" || input.channel === "webhook") {
            const limit = await ports.rateLimit({
              key: `testfire:${ctx.actor().id}`,
              windowSeconds: 60,
              max: 10,
            });
            if (!limit.allowed) {
              throw new TestFireRateLimitedError(
                buildRetryAfterMessage({
                  prefix: "Too many test fires.",
                  resetAt: limit.resetAt,
                }),
                limit.resetAt,
              );
            }
          }
          let recipients: string[] = [];
          if (input.channel === "email") {
            const email = ctx.session?.user.email;
            if (!email) {
              throw new TestFireUnavailableError(
                "email",
                "Your account has no email address to send a test fire to.",
              );
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
              const saved = await ctx.app.automation.tryGetById({
                triggerId: input.automationId,
                projectId: input.projectId,
              });
              token = ports.providers.decryptSlackBotToken(saved?.actionParams ?? {});
            }
            if (!token || !channel) {
              throw new TestFireUnavailableError(
                "slack",
                "Add a Slack bot token and channel before sending a test fire.",
              );
            }
            botDestination = { token, channel };
          }

          // ADR-040 §3: header secrets never reach the client, so a saved
          // automation's test fire carries the kept sentinel — resolve it
          // against the stored ciphertext, exactly like the Slack bot token
          // above. Unresolvable kept values (fresh draft, renamed header) are
          // dropped rather than sent as the literal sentinel.
          // Widened past the input schema on purpose: signingSecrets is
          // resolved server-side from the saved trigger and is deliberately not
          // accepted from the browser.
          let webhookDestination: TestFireWebhookDestination | null | undefined =
            input.webhookDestination;
          if (
            webhookDestination &&
            Object.values(webhookDestination.headers).includes(WEBHOOK_HEADER_VALUE_KEPT)
          ) {
            let saved: Record<string, string> = {};
            if (input.automationId) {
              const row = await ctx.app.automation.tryGetById({
                triggerId: input.automationId,
                projectId: input.projectId,
              });
              const stored = (row?.actionParams ?? {}) as AutomationWebhookStoredParams;
              if (stored?.url !== webhookDestination.url) {
                throw new TestFireUnavailableError(
                  "webhook",
                  "Re-enter webhook header values after changing the destination URL.",
                );
              }
              saved = ports.providers.decryptWebhookHeaders(stored);
            }
            const headers: Record<string, string> = {};
            for (const [name, value] of Object.entries(webhookDestination.headers)) {
              if (value === WEBHOOK_HEADER_VALUE_KEPT) {
                if (saved[name] !== undefined) headers[name] = saved[name];
                continue;
              }
              headers[name] = value;
            }
            webhookDestination = { ...webhookDestination, headers };
          }

          // The signing secret is a stored secret too, so the browser never has
          // it and cannot send it. Resolve it from the saved trigger so a test
          // fire signs exactly as a real one does, which is the only way an
          // author can point the button at their receiver's verification.
          if (webhookDestination && input.automationId) {
            const row = await ctx.app.automation.tryGetById({
              triggerId: input.automationId,
              projectId: input.projectId,
            });
            const signingSecrets = ports.providers.decryptWebhookSigningSecrets(
              (row?.actionParams ?? {}) as AutomationWebhookStoredParams,
            );
            if (signingSecrets.length > 0) {
              webhookDestination = { ...webhookDestination, signingSecrets };
            }
          }

          const project = await ctx.app.automation.getProjectIdentity(input.projectId);
          return await ctx.app.automation.testFire({
            channel: input.channel,
            trigger: input.trigger,
            project,
            draft: input.draft,
            recipients,
            webhook: input.webhook,
            botDestination,
            webhookDestination,
            graphAlert: input.graphAlert,
            report: input.report,
          });
        } catch (err) {
          raiseAsHandled(err);
        }
      }),

      upsert: policy("triggers:update")(procedure.input(automationApiUpsertInputSchema)).mutation(
        async ({ ctx, input }) => {
          const isGraphAlert = !!input.customGraphId;
          const isReport = !isGraphAlert && !!input.report;
          let parsedActionParams: Record<string, unknown> = {};
          try {
            ctx.app.automation.validateTemplateDraft(input.templates);
            // The webhook channel ships dark (ADR-040 §7): gate the save route as
            // well as the picker, so the flag can't be bypassed via the API.
            if (input.action === TriggerAction.SEND_WEBHOOK) {
              await ctx.app.automation.assertWebhookChannelEnabled({
                projectId: input.projectId,
                userId: ctx.actor().id,
              });
            }
            if (isGraphAlert) {
              // Graph alerts only support notify channels — there is no
              // "ADD_TO_DATASET on a metric crossing a threshold" UX.
              if (!NOTIFY_TRIGGER_ACTIONS.has(input.action)) {
                throw new GraphAlertChannelUnsupportedError();
              }
              if (!input.graphAlert) {
                throw new GraphAlertThresholdRequiredError();
              }
              if (!input.alertType) {
                throw new GraphAlertSeverityRequiredError();
              }
              // The graph must belong to the calling project — multitenancy
              // gate. Without this a hostile client could attach a trigger to
              // a graph from another tenant. The rule is the application's, so
              // a second writing door cannot forget it.
              await ctx.app.automation.requireCustomGraphInProject({
                customGraphId: input.customGraphId ?? "",
                projectId: input.projectId,
              });
            }
            if (isReport) {
              // A report sends a rendered notification on a schedule — notify
              // channels only, like alerts.
              if (
                input.action !== TriggerAction.SEND_EMAIL &&
                input.action !== TriggerAction.SEND_SLACK_MESSAGE
              ) {
                throw new ReportChannelUnsupportedError();
              }
            }
            // Per-action shape validation: the provider registry's per-action
            // Zod schema is the authoritative shape for actionParams. The
            // contract's `automationApiActionParamsSchema` accepts the union for
            // the wire format; this pass narrows by action, so a SEND_EMAIL
            // upsert can't accidentally save a dataset config (and
            // ADD_TO_DATASET can't persist an empty datasetId, etc.).
            const perAction = ports.providers.actionParamsSchemaFor(input.action);
            const perActionParsed = perAction.safeParse(input.actionParams);
            if (!perActionParsed.success) {
              throw new InvalidActionParamsError(
                `Invalid actionParams for ${input.action}: ${perActionParsed.error.issues[0]?.message ?? "validation failed"}`,
                input.action,
              );
            }
            // Persist the PARSED params, not the wire object: Zod strips keys the
            // action doesn't declare, so a Slack secret typed before switching the
            // channel to Email can't ride along and land in the row in plaintext
            // (where the Slack-only encrypt/redact passes would never touch it).
            parsedActionParams = perActionParsed.data as Record<string, unknown>;
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
              (!input.actionParams.annotators || input.actionParams.annotators.length === 0)
            ) {
              throw new MissingAnnotatorError();
            }
          } catch (err) {
            raiseAsHandled(err);
          }

          // ADR-043 Subject facet: normalise + validate the trace-filter query
          // before persisting. Empty/whitespace collapses to null (the legacy
          // `filters` path). A non-empty query is dry-run through the compiler so a
          // malformed query is rejected here with author feedback rather than
          // silently failing closed (matching nothing) at dispatch time.
          const filterQuery =
            input.filterQuery && input.filterQuery.trim() !== "" ? input.filterQuery.trim() : null;
          if (filterQuery !== null) {
            try {
              ports.assertTraceFilterQueryCompiles({
                query: filterQuery,
                projectId: input.projectId,
              });
            } catch (err) {
              throw new AutomationTraceFilterInvalidError(
                err instanceof Error ? err.message : "could not parse the query",
              );
            }
          }

          // A trace automation must say which traces it is about. Checked after
          // the query is normalised, so a whitespace-only query counts as absent
          // exactly as it does everywhere else. Graph alerts and reports are
          // exempt: an alert's condition is its threshold and a report's is its
          // schedule, and both persist `filters: {}` by construction.
          if (
            !isGraphAlert &&
            !isReport &&
            filterQuery === null &&
            !hasActionableTriggerFilters(input.filters)
          ) {
            throw new TriggerFiltersRequiredError();
          }

          // ADR-041 Slack bot delivery: encrypt a freshly-entered bot token (or
          // keep the stored ciphertext when the field was left blank on edit), and
          // reject a bot connection saved with no token at all. The token is never
          // returned to the client, so honouring "kept" means reading the saved row.
          // Provider persist hooks (ADR-041 / ADR-040 §3): encrypt secrets,
          // resolve kept sentinels against the saved row (loaded lazily only
          // when a provider needs it), and reject invalid payloads (missing bot
          // token, kept headers after a URL change) as typed HandledErrors.
          const storedActionParams = await ports.providers.persistActionParamsFor(input.action, {
            incoming: parsedActionParams,
            loadExisting: async () =>
              input.triggerId
                ? (
                    await ctx.app.automation.tryGetById({
                      triggerId: input.triggerId,
                      projectId: input.projectId,
                    })
                  )?.actionParams
                : undefined,
          });

          // Annotation-queue dispatch attributes created queue items to a user
          // and skips the action when `createdByUserId` is absent. The drawer's
          // provider slice doesn't carry it, so stamp the caller here — same as
          // the legacy create mutation — or an edit would silently strip it and
          // disable dispatch for the trigger.
          // Force createdByUserId to the session user — never trust the client
          // (builder5015-002). The schema strips it from the wire; we stamp
          // unconditionally on the annotation-queue branch below.
          const actionParams: Record<string, unknown> =
            input.action === TriggerAction.ADD_TO_ANNOTATION_QUEUE
              ? {
                  ...(storedActionParams as Record<string, unknown>),
                  createdByUserId: ctx.actor().id,
                }
              : { ...(storedActionParams as Record<string, unknown>) };

          // Graph alerts: route the row shape through the SSOT builder so it's
          // byte-identical to what `graphs.updateById` writes on the dashboard
          // path (N1 — the sweep fixed graphs.ts but automations.ts was still
          // hand-rolling the row). The dispatcher only knows one shape; drift
          // between the two writers silently breaks dispatch for whichever
          // format loses.
          let data: Omit<
            CreateTriggerCommand,
            "id" | "projectId" | "lastRunAt" | "notificationCadence" | "traceDebounceMs"
          >;
          if (isGraphAlert && input.graphAlert && input.customGraphId) {
            const graphAlert: GraphAlertActionParams = input.graphAlert;
            const builderInput = {
              id: input.triggerId ?? ksuid(TRIGGER_KSUID_RESOURCE).toString(),
              name: input.name,
              projectId: input.projectId,
              action: input.action,
              alertType: input.alertType ?? "INFO",
              customGraphId: input.customGraphId,
              actionParams: {
                ...actionParams,
                ...graphAlert,
              },
            };
            const built = buildGraphAlertTriggerData({
              ...builderInput,
              action: notifyingActionOr(builderInput.action, "graph alert"),
            });
            data = {
              name: built.name,
              action: built.action,
              triggerKind: "ALERT",
              alertType: built.alertType,
              filters: z.record(z.string(), z.unknown()).parse(built.filters),
              // Graph alerts never carry a trace-filter query; clear it so a kind
              // conversion can't leave a stale one behind.
              filterQuery: null,
              customGraphId: built.customGraphId,
              actionParams: z.record(z.string(), z.unknown()).parse(built.actionParams),
              slackTemplateType: input.templates.slackTemplateType ?? null,
              slackTemplate: input.templates.slackTemplate ?? null,
              emailSubjectTemplate: input.templates.emailSubjectTemplate ?? null,
              emailBodyTemplate: input.templates.emailBodyTemplate ?? null,
            };
          } else if (isReport && input.report) {
            const built = buildReportTriggerData({
              id: input.triggerId ?? ksuid(TRIGGER_KSUID_RESOURCE).toString(),
              name: input.name,
              projectId: input.projectId,
              action: notifyingActionOr(input.action, "report"),
              actionParams: { ...actionParams, ...input.report },
            });
            data = {
              name: built.name,
              action: built.action,
              triggerKind: "REPORT",
              filters: z.record(z.string(), z.unknown()).parse(built.filters),
              // Converting an existing graph alert into a report must release the
              // graph: a left-behind `customGraphId` re-arms the row as a threshold
              // alert on the heartbeat path, so the report fires as an alert too.
              customGraphId: null,
              // A trace-query report sends the traces matching the author's Subject
              // query — without this the report would only ever send the newest
              // traces in the window. A graph/dashboard report has no trace query,
              // so the column is cleared (a source change can't strand a stale one).
              filterQuery: input.report.source.kind === "traceQuery" ? filterQuery : null,
              actionParams: z.record(z.string(), z.unknown()).parse(built.actionParams),
              slackTemplateType: input.templates.slackTemplateType ?? null,
              slackTemplate: input.templates.slackTemplate ?? null,
              emailSubjectTemplate: input.templates.emailSubjectTemplate ?? null,
              emailBodyTemplate: input.templates.emailBodyTemplate ?? null,
            };
          } else {
            data = {
              name: input.name,
              action: input.action,
              triggerKind: "AUTOMATION",
              alertType: input.alertType ?? null,
              // A trace-subject automation supersedes the structured `filters` with
              // its liqe query; persist an empty `{}` so the legacy matcher is a
              // no-op and the dispatcher reads `filterQuery` instead.
              filters: filterQuery !== null ? {} : input.filters,
              filterQuery,
              customGraphId: input.customGraphId ?? null,
              actionParams,
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
            trigger = await ctx.app.automation.update({
              id: input.triggerId,
              projectId: input.projectId,
              ...data,
              ...(cadenceUpdate !== undefined ? { notificationCadence: cadenceUpdate } : {}),
              ...(input.traceDebounceMs !== undefined
                ? { traceDebounceMs: input.traceDebounceMs }
                : {}),
            });
          } else {
            // A graph alert owns its custom-graph's unique `customGraphId` slot.
            // `deleteById` soft-deletes (keeps the row and its @unique
            // customGraphId occupied), so a fresh `create` for a graph that ever
            // had an alert would violate the unique index — an unhandled P2002 →
            // 500, with no UI path to recover since the soft-deleted row is hidden.
            // Reactivate the existing row instead, matching the legacy
            // graphs.updateById upsert-by-customGraphId behaviour.
            const existingForGraph =
              isGraphAlert && input.customGraphId
                ? await ctx.app.automation.tryGetByCustomGraphId({
                    projectId: input.projectId,
                    customGraphId: input.customGraphId,
                  })
                : null;
            if (existingForGraph) {
              trigger = await ctx.app.automation.update({
                id: existingForGraph.id,
                projectId: input.projectId,
                ...data,
                deleted: false,
                active: true,
                lastRunAt: new Date(),
                notificationCadence: resolveCadenceForCreate(
                  input.action,
                  input.notificationCadence,
                  isGraphAlert,
                ),
                traceDebounceMs: input.traceDebounceMs ?? DEFAULT_TRACE_DEBOUNCE_MS,
              });
            } else {
              trigger = await ctx.app.automation.create({
                id: ksuid(TRIGGER_KSUID_RESOURCE).toString(),
                projectId: input.projectId,
                lastRunAt: new Date(),
                notificationCadence: resolveCadenceForCreate(
                  input.action,
                  input.notificationCadence,
                  isGraphAlert,
                ),
                traceDebounceMs: input.traceDebounceMs ?? DEFAULT_TRACE_DEBOUNCE_MS,
                ...data,
              });
            }
          }

          if (isReport && input.report) {
            // Wire the report onto the calendar scheduler (ADR-044): its trigger
            // id is the scheduler targetId; publishWake nudges every pod's loop.
            await ctx.app.automation.syncReportSchedule({
              projectId: input.projectId,
              triggerId: trigger.id,
              cron: input.report.schedule.cron,
              timezone: input.report.schedule.timezone,
            });
          } else {
            // Editing a report into a trace automation or graph alert must retire
            // its calendar entry — otherwise the ScheduledJob keeps waking forever
            // and the report handler repeatedly loads a now-non-report trigger,
            // fails to parse its actionParams, and skips every cadence. Idempotent,
            // so a trigger that was never a report costs one no-op deactivate.
            await ctx.app.automation.removeReportSchedule({
              projectId: input.projectId,
              triggerId: trigger.id,
            });
          }

          await ctx.app.automation.invalidate(input.projectId);
          return redactTriggerForRead(trigger);
        },
      ),
    });
  }
}

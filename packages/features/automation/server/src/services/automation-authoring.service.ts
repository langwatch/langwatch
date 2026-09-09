/**
 * Everything the authoring surface does beyond reading a row back. It lived in
 * the tRPC transport class, where the REST door could not reach it. The caller —
 * whose id stamps an annotation queue and whose address a test fire is delivered
 * to - arrives as an argument, never read from a session.
 * Spec: ADR-026, ADR-031, ADR-040, ADR-041, ADR-043, ADR-044.
 */
import {
  AutomationFiltersUnsupportedError,
  AutomationTraceFilterInvalidError,
  AutomationWebhookUpsertRequiredError,
  buildGraphAlertTriggerData,
  buildReportTriggerData,
  DEFAULT_TRACE_DEBOUNCE_MS,
  extractReportFromTriggerRow,
  GraphAlertChannelUnsupportedError,
  GraphAlertSeverityRequiredError,
  GraphAlertThresholdRequiredError,
  hasActionableTriggerFilters,
  InvalidActionParamsError,
  MissingAnnotatorError,
  MissingSlackWebhookError,
  NOTIFY_TRIGGER_ACTIONS,
  NotificationDeliveryError,
  ReportChannelUnsupportedError,
  ReportScheduleMissingError,
  TestFireRateLimitedError,
  TestFireUnavailableError,
  TriggerAction,
  TriggerFiltersRequiredError,
  type AutomationApiCreateInput,
  type AutomationApiListSlackChannelsInput,
  type AutomationApiTestFireInput,
  type AutomationApiToggleTriggerInput,
  type AutomationApiUpdateTriggerFiltersInput,
  type AutomationApiUpsertInput,
  type AutomationAction,
  type AutomationAuthor,
  type AutomationTestFireAuthor,
  type AutomationListRow,
  type AutomationPersistCapCount,
  type AutomationService,
  type CreateTriggerCommand,
  type GraphAlertActionParams,
  type SlackChannelListing,
  type TestFireResult,
  type TestFireWebhookDestination,
  type Trigger,
  WEBHOOK_HEADER_VALUE_KEPT,
} from "@langwatch/automation-contract";
import { isDispatchError } from "@langwatch/eventing";
import { HandledError } from "@langwatch/handled-error";
import { generate as ksuid } from "@langwatch/ksuid";
import type { Monitor, MonitorApi } from "@langwatch/monitor-contract";
import { nowInstant, toDate } from "@langwatch/time";
import { z } from "zod";

import type {
  AutomationCallCounter,
  AutomationProviderSecrets,
  AutomationSlackDirectory,
  AutomationTraceFilterCompiler,
  AutomationWebhookStoredParams,
} from "../app/automation.app.ts";
import {
  extractCheckKeys,
  notifyingActionOr,
  partitionFilterFields,
  resolveCadenceForCreate,
  resolveCadenceForUpdate,
  resolveKeptWebhookHeaders,
  validateEmailRecipientFormats,
} from "../rules/automation-authoring.rules.ts";
import { buildRetryAfterMessage } from "../rules/retry-after-message.rules.ts";
import type { AutomationRulesService } from "./automation-rules.service.ts";

/**
 * The app's KSUID resource for a trigger row (`KSUID_RESOURCES.TRIGGER`). The
 * literal rather than the app's constant table: the prefix is part of the id
 * format already written to the database, so it belongs with the writer.
 */
const TRIGGER_KSUID_RESOURCE = "trigger";

/** How often one person may press the test-fire button, and over what window. */
const TEST_FIRE_WINDOW_SECONDS = 60;
const TEST_FIRE_MAX_PER_WINDOW = 10;

/** What the authoring service reaches. */
export interface AutomationAuthoringCollaborators {
  automation: AutomationService;
  rules: AutomationRulesService;
  monitors: MonitorApi;
  providers: AutomationProviderSecrets;
  slackChannels: AutomationSlackDirectory;
  traceFilters: AutomationTraceFilterCompiler;
  limits: AutomationCallCounter;
}

export class AutomationAuthoringService {
  static create(collaborators: AutomationAuthoringCollaborators): AutomationAuthoringService {
    return new AutomationAuthoringService(collaborators);
  }

  private constructor(private readonly collaborators: AutomationAuthoringCollaborators) {}

  /**
   * Strips secrets from a trigger row before it leaves the server through the
   * provider registry's redact hook: the encrypted Slack bot token (ADR-041)
   * and webhook header values (ADR-040 §3 - names echo with the kept sentinel,
   * values never return). Identity for every other action.
   */
  redactForRead<T extends { action: AutomationAction; actionParams: unknown }>(trigger: T): T {
    return {
      ...trigger,
      actionParams: this.collaborators.providers.redactActionParamsFor(
        trigger.action,
        trigger.actionParams ?? {},
      ),
    };
  }

  /** One automation as the browser reads it, or null when the project has none. */
  async findRedactedById(input: {
    triggerId: string;
    projectId: string;
  }): Promise<Trigger | null> {
    const trigger = await this.collaborators.automation.tryGetById(input);

    // Never return the encrypted bot token to the browser (ADR-041).
    return trigger ? this.redactForRead(trigger) : null;
  }

  /**
   * The automations list: every row, redacted, with the monitors its conditions
   * name and the custom graph a graph alert points at, so the page renders
   * "Graph: my-p95" without a second fetch per row.
   */
  async listRows(input: { projectId: string }): Promise<AutomationListRow[]> {
    const triggers = await this.collaborators.automation.getAllForProject(input);
    const allCheckIds = triggers.flatMap((trigger) => extractCheckKeys(trigger.filters));
    const allChecks = await this.collaborators.monitors.getAllByIds({
      monitorIds: allCheckIds,
      projectId: input.projectId,
    });
    const checksMap = allChecks.reduce<Record<string, Monitor>>((map, check) => {
      map[check.id] = check;

      return map;
    }, {});

    const customGraphIds = triggers
      .map((trigger) => trigger.customGraphId)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    const customGraphs =
      customGraphIds.length > 0
        ? await this.collaborators.automation.getCustomGraphNamesByIds({
            customGraphIds,
            projectId: input.projectId,
          })
        : [];
    const customGraphsById = new Map(customGraphs.map((graph) => [graph.id, graph]));

    return triggers.map((trigger) => ({
      ...this.redactForRead(trigger),
      checks: extractCheckKeys(trigger.filters)
        .map((id) => checksMap[id])
        .filter((check): check is Monitor => Boolean(check)),
      customGraph: trigger.customGraphId
        ? (customGraphsById.get(trigger.customGraphId) ?? null)
        : null,
    }));
  }

  /**
   * Today's ceiling and what each automation has spent of it, so the list can
   * say "N matches skipped today" rather than leaving the customer to wonder
   * why an automation they can see running produced nothing.
   */
  async readDailyCapStatus(input: {
    projectId: string;
  }): Promise<{ cap: number; counts: Record<string, AutomationPersistCapCount> }> {
    const cap = await this.collaborators.automation.resolvePersistDailyCap(input.projectId);
    const triggers = await this.collaborators.automation.getAllForProject(input);
    const counts = await this.collaborators.automation.readPersistCapCounts({
      projectId: input.projectId,
      triggerIds: triggers.map((trigger) => trigger.id),
      now: nowInstant(),
      cap,
    });

    return { cap, counts };
  }

  /** The Slack conversations a bot token can see, for the channel picker. */
  async listSlackChannels(input: AutomationApiListSlackChannelsInput): Promise<SlackChannelListing> {
    const token = await this.resolveSlackBotToken({
      typed: input.botToken,
      automationId: input.automationId,
      projectId: input.projectId,
    });

    if (!token) return { channels: [], error: "no_token", gaps: [] };

    return this.collaborators.slackChannels.list(token);
  }

  /**
   * The legacy create path. It carries no graph or report shape, so it only
   * ever writes trace automations and the condition is always required.
   */
  async create(args: {
    input: AutomationApiCreateInput;
    author: AutomationAuthor;
  }): Promise<Trigger> {
    const { input, author } = args;

    // This mutation cannot carry the validated, encrypted webhook destination
    // shape. Never let a direct caller create a malformed or flag-bypassing
    // SEND_WEBHOOK row; the provider-aware upsert is the sole webhook writer.
    if (input.action === TriggerAction.SEND_WEBHOOK) {
      throw new AutomationWebhookUpsertRequiredError();
    }

    this.collaborators.rules.assertTraceConditionPresent(input.filters);

    await this.collaborators.rules.getProjectIdentity(input.projectId);

    const actionParams: Record<string, unknown> = { ...input.actionParams };

    if (input.action === TriggerAction.ADD_TO_ANNOTATION_QUEUE) {
      // Server-stamp the creator: the schema does not expose it to the wire, so
      // a client cannot forge who a queue item is attributed to.
      actionParams.createdByUserId = author.id;

      if (!input.actionParams.annotators) throw new MissingAnnotatorError();
    }

    if (input.action === TriggerAction.SEND_SLACK_MESSAGE) {
      if (!input.actionParams.slackWebhook) throw new MissingSlackWebhookError();
      // Recipients are checked by RFC shape only, the same rule `save` applies:
      // external addresses are intentionally allowed and the UI badges them, so
      // create and edit cannot disagree about what an author may type.
    } else if (namesEmailRecipients(input)) {
      validateEmailRecipientFormats(input.actionParams.members ?? []);
    }

    const trigger = await this.collaborators.automation.create({
      id: ksuid(TRIGGER_KSUID_RESOURCE).toString(),
      name: input.name,
      action: input.action,
      actionParams,
      filters: input.filters,
      projectId: input.projectId,
      lastRunAt: toDate(nowInstant()),
      notificationCadence: resolveCadenceForCreate(input.action, input.notificationCadence),
    });

    return this.redactForRead(trigger);
  }

  /**
   * Pausing and resuming. A report's schedule does not live on `Trigger.active`
   * - it lives on the scheduler - so flipping the flag alone left the calendar
   * entry claiming its slot every cadence for a report that delivers nothing.
   */
  async setActive(input: AutomationApiToggleTriggerInput): Promise<Trigger> {
    const existing = await this.collaborators.rules.getById({
      triggerId: input.triggerId,
      projectId: input.projectId,
    });

    const isReport = existing.triggerKind === "REPORT";
    const report = isReport ? extractReportFromTriggerRow(existing.actionParams) : null;

    if (isReport && input.active && !report) throw new ReportScheduleMissingError();

    const trigger = await this.collaborators.automation.update({
      id: input.triggerId,
      projectId: input.projectId,
      active: input.active,
      // Resuming clears the platform's pause record. Leaving it behind would
      // make a running automation keep claiming it was paused for runaway
      // volume, and the next genuine pause would be indistinguishable from it.
      ...(input.active ? { pausedReason: null, pausedAt: null } : {}),
    });

    if (isReport) {
      if (input.active && report) {
        await this.collaborators.automation.syncReportSchedule({
          projectId: input.projectId,
          triggerId: input.triggerId,
          cron: report.schedule.cron,
          timezone: report.schedule.timezone,
        });
      } else {
        await this.collaborators.automation.removeReportSchedule({
          projectId: input.projectId,
          triggerId: input.triggerId,
        });
      }
    }

    return this.redactForRead(trigger);
  }

  /** Replaces one automation's condition, keeping it from matching everything. */
  async replaceFilters(input: AutomationApiUpdateTriggerFiltersInput): Promise<Trigger> {
    const { sanitized, unknownFields } = partitionFilterFields(input.filters);

    if (unknownFields.length > 0 && Object.keys(sanitized).length === 0) {
      throw new AutomationFiltersUnsupportedError(unknownFields);
    }

    if (!hasActionableTriggerFilters(sanitized)) {
      const existing = await this.collaborators.rules.getById({
        triggerId: input.triggerId,
        projectId: input.projectId,
      });

      this.collaborators.rules.assertConditionSurvivesEdit({ existing, filters: sanitized });
    }

    const trigger = await this.collaborators.automation.update({
      id: input.triggerId,
      projectId: input.projectId,
      filters: sanitized,
    });

    return this.redactForRead(trigger);
  }

  /** Renders and delivers one test notification to the author themselves. */
  async testFire(args: {
    input: AutomationApiTestFireInput;
    author: AutomationTestFireAuthor;
  }): Promise<TestFireResult> {
    const { input, author } = args;

    try {
      // The webhook channel ships dark (ADR-040 §7): the type picker is
      // flag-gated client-side, and the server refuses the channel too so the
      // flag cannot be bypassed by calling the API directly.
      if (input.channel === "webhook") {
        await this.collaborators.rules.assertWebhookChannelEnabled({
          projectId: input.projectId,
          userId: author.id,
        });
      }

      await this.countTestFire({ channel: input.channel, author });

      const recipients = this.testFireRecipients({ channel: input.channel, author });
      const botDestination = await this.testFireSlackBot(input);
      const webhookDestination = await this.testFireWebhook(input);
      const project = await this.collaborators.rules.getProjectIdentity(input.projectId);

      return await this.collaborators.automation.testFire({
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
  }

  /**
   * The authoring drawer's save: one row, whichever of the three kinds it is.
   *
   * A graph alert and a report go through their own SSOT builders so the row is
   * byte-identical to what the dashboard path writes - the dispatcher knows one
   * shape, and drift between two writers silently breaks whichever loses.
   */
  async save(args: { input: AutomationApiUpsertInput; author: AutomationAuthor }): Promise<Trigger> {
    const { input, author } = args;
    const isGraphAlert = !!input.customGraphId;
    const isReport = !isGraphAlert && !!input.report;
    const parsedActionParams = await this.validateDraft({ input, author, isGraphAlert, isReport });
    const filterQuery = this.normalizeFilterQuery(input);

    // A trace automation must say which traces it is about. Checked after the
    // query is normalised, so a whitespace-only query counts as absent exactly
    // as it does everywhere else. Graph alerts and reports are exempt: an
    // alert's condition is its threshold and a report's is its schedule.
    const isTraceAutomation = !isGraphAlert && !isReport;
    const saysWhichTraces = filterQuery !== null || hasActionableTriggerFilters(input.filters);

    if (isTraceAutomation && !saysWhichTraces) throw new TriggerFiltersRequiredError();

    // Provider persist hooks (ADR-041 / ADR-040 §3): encrypt the secrets and
    // resolve the "keep what is there" sentinels against the saved row.
    const storedActionParams = await this.collaborators.providers.persistActionParamsFor(
      input.action,
      {
        incoming: parsedActionParams,
        loadExisting: async () =>
          input.triggerId
            ? (
                await this.collaborators.automation.tryGetById({
                  triggerId: input.triggerId,
                  projectId: input.projectId,
                })
              )?.actionParams
            : undefined,
      },
    );

    // Annotation-queue dispatch attributes queue items to a user and skips the
    // action when `createdByUserId` is absent. The drawer's provider slice does
    // not carry it, so it is stamped from the caller here - an edit would
    // otherwise strip it and disable dispatch for the automation.
    const actionParams: Record<string, unknown> =
      input.action === TriggerAction.ADD_TO_ANNOTATION_QUEUE
        ? { ...(storedActionParams as Record<string, unknown>), createdByUserId: author.id }
        : { ...(storedActionParams as Record<string, unknown>) };

    const data = this.rowFor({ input, actionParams, filterQuery, isGraphAlert, isReport });
    const trigger = await this.writeRow({ input, data, isGraphAlert });

    if (isReport && input.report) {
      // Wire the report onto the calendar scheduler (ADR-044): its trigger id is
      // the scheduler targetId; the wake nudges every pod's loop.
      await this.collaborators.automation.syncReportSchedule({
        projectId: input.projectId,
        triggerId: trigger.id,
        cron: input.report.schedule.cron,
        timezone: input.report.schedule.timezone,
      });
    } else {
      // Editing a report into a trace automation or a graph alert must retire
      // its calendar entry, or the scheduled job keeps waking forever and the
      // handler reloads a row it can no longer parse. Idempotent.
      await this.collaborators.automation.removeReportSchedule({
        projectId: input.projectId,
        triggerId: trigger.id,
      });
    }

    await this.collaborators.automation.invalidate(input.projectId);

    return this.redactForRead(trigger);
  }

  /** Everything a save is refused for before a single secret is encrypted. */
  private async validateDraft(args: {
    input: AutomationApiUpsertInput;
    author: AutomationAuthor;
    isGraphAlert: boolean;
    isReport: boolean;
  }): Promise<Record<string, unknown>> {
    const { input, author, isGraphAlert, isReport } = args;

    try {
      this.collaborators.automation.validateTemplateDraft(input.templates);

      if (input.action === TriggerAction.SEND_WEBHOOK) {
        await this.collaborators.rules.assertWebhookChannelEnabled({
          projectId: input.projectId,
          userId: author.id,
        });
      }

      if (isGraphAlert) {
        // Graph alerts only support notify channels - there is no
        // "ADD_TO_DATASET on a metric crossing a threshold" experience.
        if (!NOTIFY_TRIGGER_ACTIONS.has(input.action)) {
          throw new GraphAlertChannelUnsupportedError();
        }
        if (!input.graphAlert) throw new GraphAlertThresholdRequiredError();
        if (!input.alertType) throw new GraphAlertSeverityRequiredError();

        await this.collaborators.rules.assertCustomGraphInProject({
          customGraphId: input.customGraphId ?? "",
          projectId: input.projectId,
        });
      }

      // A report sends a rendered notification on a schedule - notify channels
      // only, like alerts.
      if (
        isReport &&
        input.action !== TriggerAction.SEND_EMAIL &&
        input.action !== TriggerAction.SEND_SLACK_MESSAGE
      ) {
        throw new ReportChannelUnsupportedError();
      }

      // The provider registry's per-action schema is the authoritative shape.
      // The contract's own schema accepts the union for the wire format; this
      // pass narrows by action, so a SEND_EMAIL save cannot store a dataset
      // configuration and ADD_TO_DATASET cannot persist an empty datasetId.
      const perAction = this.collaborators.providers.actionParamsSchemaFor(input.action);
      const parsed = perAction.safeParse(input.actionParams);

      if (!parsed.success) {
        throw new InvalidActionParamsError(
          `Invalid actionParams for ${input.action}: ${parsed.error.issues[0]?.message ?? "validation failed"}`,
          input.action,
        );
      }

      if (namesEmailRecipients(input)) {
        validateEmailRecipientFormats(input.actionParams.members ?? []);
      }

      // Slack webhook and bot-channel presence are enforced by the per-action
      // schema above. The bot-token check, which must allow "kept" on edit,
      // runs in the provider's persist hook: it needs the saved row.
      const queueWithoutAnnotators =
        input.action === TriggerAction.ADD_TO_ANNOTATION_QUEUE &&
        (input.actionParams.annotators?.length ?? 0) === 0;

      if (queueWithoutAnnotators) throw new MissingAnnotatorError();

      // Persist the PARSED params, not the wire object: zod strips keys the
      // action does not declare, so a Slack secret typed before switching the
      // channel to email cannot ride along into the row in plaintext.
      return parsed.data as Record<string, unknown>;
    } catch (err) {
      raiseAsHandled(err);
    }
  }

  /**
   * ADR-043 Subject facet: empty or whitespace collapses to null (the legacy
   * `filters` path), and a non-empty query is dry-run through the compiler so a
   * malformed one is refused here with author feedback rather than silently
   * failing closed at dispatch time.
   */
  private normalizeFilterQuery(input: AutomationApiUpsertInput): string | null {
    const filterQuery =
      input.filterQuery && input.filterQuery.trim() !== "" ? input.filterQuery.trim() : null;

    if (filterQuery === null) return null;

    try {
      this.collaborators.traceFilters.assertCompiles({
        query: filterQuery,
        projectId: input.projectId,
      });
    } catch (err) {
      throw new AutomationTraceFilterInvalidError(
        err instanceof Error ? err.message : "could not parse the query",
      );
    }

    return filterQuery;
  }

  /** The row one save writes, in the shape its kind is dispatched from. */
  private rowFor(args: {
    input: AutomationApiUpsertInput;
    actionParams: Record<string, unknown>;
    filterQuery: string | null;
    isGraphAlert: boolean;
    isReport: boolean;
  }): AutomationRowDraft {
    const { input, actionParams, filterQuery, isGraphAlert, isReport } = args;
    const templates = {
      slackTemplateType: input.templates.slackTemplateType ?? null,
      slackTemplate: input.templates.slackTemplate ?? null,
      emailSubjectTemplate: input.templates.emailSubjectTemplate ?? null,
      emailBodyTemplate: input.templates.emailBodyTemplate ?? null,
    };

    if (isGraphAlert && input.graphAlert && input.customGraphId) {
      const graphAlert: GraphAlertActionParams = input.graphAlert;
      const built = buildGraphAlertTriggerData({
        id: input.triggerId ?? ksuid(TRIGGER_KSUID_RESOURCE).toString(),
        name: input.name,
        projectId: input.projectId,
        action: notifyingActionOr(input.action, "graph alert"),
        alertType: input.alertType ?? "INFO",
        customGraphId: input.customGraphId,
        actionParams: { ...actionParams, ...graphAlert },
      });

      return {
        name: built.name,
        action: built.action,
        triggerKind: "ALERT",
        alertType: built.alertType,
        filters: recordOf(built.filters),
        // Graph alerts never carry a trace-filter query; clear it so a kind
        // conversion cannot leave a stale one behind.
        filterQuery: null,
        customGraphId: built.customGraphId,
        actionParams: recordOf(built.actionParams),
        ...templates,
      };
    }

    if (isReport && input.report) {
      const sendsMatchingTraces = input.report.source.kind === "traceQuery";
      const built = buildReportTriggerData({
        id: input.triggerId ?? ksuid(TRIGGER_KSUID_RESOURCE).toString(),
        name: input.name,
        projectId: input.projectId,
        action: notifyingActionOr(input.action, "report"),
        actionParams: { ...actionParams, ...input.report },
      });

      return {
        name: built.name,
        action: built.action,
        triggerKind: "REPORT",
        filters: recordOf(built.filters),
        // Converting a graph alert into a report must release the graph: a
        // left-behind `customGraphId` re-arms the row as a threshold alert on
        // the heartbeat path, so the report fires as an alert too.
        customGraphId: null,
        // A trace-query report sends the traces matching the author's Subject
        // query; a graph or dashboard report has no trace query, so the column
        // is cleared and a source change cannot strand a stale one.
        filterQuery: sendsMatchingTraces ? filterQuery : null,
        actionParams: recordOf(built.actionParams),
        ...templates,
      };
    }

    return {
      name: input.name,
      action: input.action,
      triggerKind: "AUTOMATION",
      alertType: input.alertType ?? null,
      // A trace-subject automation supersedes the structured `filters` with its
      // query; an empty `{}` makes the legacy matcher a no-op and the
      // dispatcher reads `filterQuery` instead.
      filters: filterQuery !== null ? {} : input.filters,
      filterQuery,
      customGraphId: input.customGraphId ?? null,
      actionParams,
      ...templates,
    };
  }

  /** The create, the update, and the one re-use a soft-deleted graph alert needs. */
  private async writeRow(args: {
    input: AutomationApiUpsertInput;
    data: AutomationRowDraft;
    isGraphAlert: boolean;
  }): Promise<Trigger> {
    const { input, data, isGraphAlert } = args;

    if (input.triggerId) {
      const cadence = resolveCadenceForUpdate(
        input.action,
        input.notificationCadence,
        isGraphAlert,
      );

      return this.collaborators.automation.update({
        id: input.triggerId,
        projectId: input.projectId,
        ...data,
        ...(cadence !== undefined ? { notificationCadence: cadence } : {}),
        ...(input.traceDebounceMs !== undefined
          ? { traceDebounceMs: input.traceDebounceMs }
          : {}),
      });
    }

    // A graph alert owns its custom graph's unique `customGraphId` slot, and a
    // delete is a soft delete that keeps the row and the slot. A fresh create
    // for a graph that ever had an alert would violate the unique index, with
    // no path to recover since the soft-deleted row is hidden.
    const existingForGraph =
      isGraphAlert && input.customGraphId
        ? await this.collaborators.automation.tryGetByCustomGraphId({
            projectId: input.projectId,
            customGraphId: input.customGraphId,
          })
        : null;

    if (existingForGraph) {
      return this.collaborators.automation.update({
        id: existingForGraph.id,
        projectId: input.projectId,
        ...data,
        deleted: false,
        active: true,
        lastRunAt: toDate(nowInstant()),
        notificationCadence: resolveCadenceForCreate(
          input.action,
          input.notificationCadence,
          isGraphAlert,
        ),
        traceDebounceMs: input.traceDebounceMs ?? DEFAULT_TRACE_DEBOUNCE_MS,
      });
    }

    return this.collaborators.automation.create({
      id: ksuid(TRIGGER_KSUID_RESOURCE).toString(),
      projectId: input.projectId,
      lastRunAt: toDate(nowInstant()),
      notificationCadence: resolveCadenceForCreate(
        input.action,
        input.notificationCadence,
        isGraphAlert,
      ),
      traceDebounceMs: input.traceDebounceMs ?? DEFAULT_TRACE_DEBOUNCE_MS,
      ...data,
    });
  }

  /**
   * Email shares the mail provider; a webhook fires at an ARBITRARY customer
   * URL from our egress addresses, so an uncapped test button would be an
   * outbound request-flood primitive (ADR-040 §4). Slack stays exempt: its
   * destination is host-pinned to hooks.slack.com.
   */
  private async countTestFire(args: {
    channel: AutomationApiTestFireInput["channel"];
    author: AutomationAuthor;
  }): Promise<void> {
    if (args.channel !== "email" && args.channel !== "webhook") return;

    const limit = await this.collaborators.limits.count({
      key: `testfire:${args.author.id}`,
      windowSeconds: TEST_FIRE_WINDOW_SECONDS,
      max: TEST_FIRE_MAX_PER_WINDOW,
    });

    if (limit.allowed) return;

    throw new TestFireRateLimitedError(
      buildRetryAfterMessage({ prefix: "Too many test fires.", resetAt: limit.resetAt }),
      limit.resetAt,
    );
  }

  /** ADR-031: a test fire is not an open relay - the recipient is the author. */
  private testFireRecipients(args: {
    channel: AutomationApiTestFireInput["channel"];
    author: AutomationTestFireAuthor;
  }): string[] {
    if (args.channel !== "email") return [];

    if (!args.author.email) {
      throw new TestFireUnavailableError(
        "email",
        "Your account has no email address to send a test fire to.",
      );
    }

    return [args.author.email];
  }

  /** The freshly-typed bot token, or the saved automation's stored one. */
  private async testFireSlackBot(
    input: AutomationApiTestFireInput,
  ): Promise<{ token: string; channel: string } | null> {
    if (input.channel !== "slack" || !input.botDestination) return null;

    const channel = input.botDestination.channelId.trim();
    const token = await this.resolveSlackBotToken({
      typed: input.botDestination.botToken,
      automationId: input.automationId,
      projectId: input.projectId,
    });

    if (!token || !channel) {
      throw new TestFireUnavailableError(
        "slack",
        "Add a Slack bot token and channel before sending a test fire.",
      );
    }

    return { token, channel };
  }

  /**
   * ADR-040 §3: header secrets never reach the client, so a kept header and the
   * signing secret are both resolved from the saved automation. A test fire
   * then signs exactly as a real one does, which is the only way an author can
   * point the button at their own receiver's verification.
   */
  private async testFireWebhook(
    input: AutomationApiTestFireInput,
  ): Promise<TestFireWebhookDestination | null> {
    let destination = input.webhookDestination;

    if (!destination) return null;

    const keepsSavedHeaders = Object.values(destination.headers).includes(
      WEBHOOK_HEADER_VALUE_KEPT,
    );

    if (keepsSavedHeaders) {
      let saved: Record<string, string> = {};

      if (input.automationId) {
        const row = await this.collaborators.automation.tryGetById({
          triggerId: input.automationId,
          projectId: input.projectId,
        });
        const stored = (row?.actionParams ?? {}) as AutomationWebhookStoredParams;

        if (stored?.url !== destination.url) {
          throw new TestFireUnavailableError(
            "webhook",
            "Re-enter webhook header values after changing the destination URL.",
          );
        }

        saved = this.collaborators.providers.decryptWebhookHeaders(stored);
      }

      destination = {
        ...destination,
        headers: resolveKeptWebhookHeaders(destination.headers, saved),
      };
    }

    if (!input.automationId) return destination;

    const row = await this.collaborators.automation.tryGetById({
      triggerId: input.automationId,
      projectId: input.projectId,
    });
    const signingSecrets = this.collaborators.providers.decryptWebhookSigningSecrets(
      (row?.actionParams ?? {}) as AutomationWebhookStoredParams,
    );

    return signingSecrets.length > 0 ? { ...destination, signingSecrets } : destination;
  }

  /** The typed token if there is one, otherwise the saved automation's. */
  private async resolveSlackBotToken(args: {
    typed: string | null | undefined;
    automationId: string | undefined;
    projectId: string;
  }): Promise<string | null> {
    const typed = args.typed?.trim() || null;

    if (typed) return typed;
    if (!args.automationId) return null;

    const saved = await this.collaborators.automation.tryGetById({
      triggerId: args.automationId,
      projectId: args.projectId,
    });

    return this.collaborators.providers.findSlackBotToken(saved?.actionParams ?? {});
  }
}

/** Whether an email draft carries a recipient list to check the shape of. */
function namesEmailRecipients(
  input: Readonly<{ action: AutomationAction; actionParams: { members?: string[] | undefined } }>,
): boolean {
  return input.action === TriggerAction.SEND_EMAIL && (input.actionParams.members?.length ?? 0) > 0;
}

/** The columns a save writes, whichever of the three kinds the automation is. */
type AutomationRowDraft = Omit<
  CreateTriggerCommand,
  "id" | "projectId" | "lastRunAt" | "notificationCadence" | "traceDebounceMs"
>;

/** A builder's own loosely-typed record, as the row column accepts it. */
function recordOf(value: unknown): Record<string, unknown> {
  return z.record(z.string(), z.unknown()).parse(value);
}

/**
 * Re-raises a thrown value on the typed channel, and never returns. Anything
 * unhandled degrades to "unknown" plus a trace id at the boundary (ADR-045).
 */
function raiseAsHandled(err: unknown): never {
  if (HandledError.isHandled(err)) throw err;

  if (isDispatchError(err)) {
    throw new NotificationDeliveryError(err.message, { customerMessage: err.customerMessage });
  }

  throw err;
}

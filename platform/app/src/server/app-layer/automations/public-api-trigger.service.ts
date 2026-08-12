import {
  DEFAULT_TRACE_DEBOUNCE_MS,
  type NotificationCadence,
} from "@langwatch/automations/cadences";
import type { SlackActionParams } from "@langwatch/automations/providers/slack";
import type { AlertType, Prisma, Trigger } from "@prisma/client";
import { TriggerAction, TriggerKind } from "@prisma/client";
import { nanoid } from "nanoid";
import { featureFlagService } from "~/server/featureFlag";
import { hasActionableTriggerFilters } from "~/server/filters/triggerFilter.matcher";
import {
  sanitizeTriggerFilters,
  type TriggerFilterValue,
} from "~/server/filters/types";
import { translateFilterToClickHouse } from "../traces/filter-to-clickhouse";
import type { AutomationCustomGraphService } from "./custom-graph.service";
import { NOTIFY_TRIGGER_ACTIONS } from "./dispatch/triggerActionDispatch";
import {
  GraphAlertIncompleteError,
  GraphNotFoundError,
  ReportChannelUnsupportedError,
  TestFireUnavailableError,
  TriggerActionImmutableError,
  TriggerChannelNotEnabledError,
  TriggerFilterQueryInvalidError,
  TriggerFiltersRequiredError,
  TriggerFiltersUnsupportedError,
  TriggerKindImmutableError,
  TriggerNotFoundError,
} from "./errors";
import {
  buildGraphAlertTriggerData,
  extractGraphAlertFromTriggerRow,
  type GraphAlertActionParams,
  graphAlertActionParamsSchema,
} from "./graph-alert.builder";
import {
  resolveNotificationCadenceForCreate,
  resolveNotificationCadenceForUpdate,
} from "./notification-cadence";
import { decryptSlackBotToken } from "./providers/slack/server";
import {
  decryptWebhookHeaders,
  decryptWebhookSigningSecrets,
  type WebhookStoredActionParams,
} from "./providers/webhook/server";
import {
  buildReportTriggerData,
  extractReportFromTriggerRow,
  type ReportActionParams,
} from "./report.builder";
import type { TriggerService } from "./trigger.service";
import type { TriggerFireHistoryService } from "./trigger-fire-history.service";
import { persistPublicApiActionParams } from "./trigger-redaction";
import type {
  DraftProject,
  TemplateDraft,
  TestFireResult,
  TestFireWebhookDestination,
} from "./trigger-template.service";
import { validateTemplateDraft } from "./trigger-template.service";

/**
 * What the public API is allowed to write, and on what terms.
 *
 * An automation written over the API is the same row the dashboard writes and
 * the same row the dispatcher reads, so it is held to the same rules rather
 * than to whatever the wire schema happened to accept: a delivery
 * configuration its channel recognises, a destination that is safe to send to,
 * a channel this project has, conditions that select something, a trace query
 * the platform can read, a graph that belongs to this project, and the cadence
 * a new notification starts on.
 *
 * Two things about an automation are fixed once it exists.
 *
 *  - **The channel.** An update states a delivery configuration for the
 *    channel already stored, which is what lets the credential rules read the
 *    incoming and stored halves as belonging to one provider (see
 *    `trigger-redaction.ts`). A save naming a different channel is refused
 *    rather than ignored.
 *  - **The kind.** A trace automation, a graph alert and a scheduled report
 *    are three different rows: an alert owns its graph's alert slot and a
 *    report owns a calendar entry. Converting one is a create and a delete.
 */
export class PublicApiTriggerService {
  constructor(
    private readonly triggers: TriggerService,
    private readonly deps: {
      graphs: AutomationCustomGraphService;
      fireHistory: TriggerFireHistoryService;
      testFire: (input: PublicApiTestFireInput) => Promise<TestFireResult>;
      resolveProject: (projectId: string) => Promise<DraftProject>;
    },
  ) {}

  /** Every automation in the project, paused ones included. */
  async getAll({ projectId }: { projectId: string }): Promise<Trigger[]> {
    return this.triggers.getAllForProject({ projectId });
  }

  async getById({
    projectId,
    triggerId,
  }: {
    projectId: string;
    triggerId: string;
  }): Promise<Trigger> {
    const trigger = await this.triggers.getById({ triggerId, projectId });
    if (!trigger || trigger.deleted) throw new TriggerNotFoundError();
    return trigger;
  }

  async create({
    projectId,
    input,
  }: {
    projectId: string;
    input: PublicApiCreateInput;
  }): Promise<Trigger> {
    await this.assertChannelEnabled({ action: input.action, projectId });
    if (input.templates) validateTemplateDraft(input.templates);

    const isGraphAlert = !!input.customGraphId;
    const isReport = !isGraphAlert && !!input.report;
    const id = nanoid();
    const data = await this.buildCreateData({ id, projectId, input });

    const trigger = await this.triggers.create({
      data: {
        ...data,
        id,
        projectId,
        message: input.message ?? null,
        notificationCadence: resolveNotificationCadenceForCreate({
          action: input.action,
          requested: input.notificationCadence,
          isGraphAlert,
        }),
        traceDebounceMs: input.traceDebounceMs ?? DEFAULT_TRACE_DEBOUNCE_MS,
        lastRunAt: new Date().getTime(),
      },
    });

    if (isReport) {
      const report = input.report as ReportActionParams;
      await this.triggers.syncReportSchedule({
        projectId,
        triggerId: trigger.id,
        cron: report.schedule.cron,
        timezone: report.schedule.timezone,
      });
    }

    await this.triggers.invalidate(projectId);
    return trigger;
  }

  /** The row a create writes, shaped by what the automation is about: a
   *  metric crossing a threshold, a schedule, or matching traces. */
  private async buildCreateData({
    id,
    projectId,
    input,
  }: {
    id: string;
    projectId: string;
    input: PublicApiCreateInput;
  }): Promise<Omit<Prisma.TriggerUncheckedCreateInput, "id" | "projectId">> {
    const filterQuery = this.readFilterQuery({
      filterQuery: input.filterQuery,
      projectId,
    });
    const filters = this.sanitizeFilters(input.filters ?? {});
    const delivery = (await persistPublicApiActionParams({
      action: input.action,
      incoming: input.actionParams,
    })) as Record<string, unknown>;

    if (input.customGraphId) {
      return this.graphAlertCreateData({
        id,
        projectId,
        input,
        customGraphId: input.customGraphId,
        delivery,
      });
    }
    if (input.report) {
      return this.reportCreateData({
        id,
        projectId,
        input,
        report: input.report,
        delivery,
        filterQuery,
      });
    }

    // A trace automation must say which traces it is about; an alert's
    // condition is its threshold and a report's is its schedule, and both
    // persist an empty condition set by construction.
    if (filterQuery === null && !hasActionableTriggerFilters(filters)) {
      throw new TriggerFiltersRequiredError();
    }
    return {
      name: input.name,
      action: input.action,
      triggerKind: TriggerKind.AUTOMATION,
      alertType: input.alertType ?? null,
      // A trace-query automation supersedes the structured conditions, so
      // the stored set is emptied and the dispatcher reads the query.
      filters: filterQuery !== null ? "{}" : JSON.stringify(filters),
      filterQuery,
      actionParams: delivery as Prisma.InputJsonValue,
      ...this.templateColumns(input.templates),
    };
  }

  private async graphAlertCreateData({
    id,
    projectId,
    input,
    customGraphId,
    delivery,
  }: {
    id: string;
    projectId: string;
    input: PublicApiCreateInput;
    customGraphId: string;
    delivery: Record<string, unknown>;
  }): Promise<Omit<Prisma.TriggerUncheckedCreateInput, "id" | "projectId">> {
    const rule = await this.readGraphAlert({
      projectId,
      action: input.action,
      alertType: input.alertType,
      customGraphId,
      graphAlert: input.graphAlert,
    });
    const built = buildGraphAlertTriggerData({
      id,
      name: input.name,
      projectId,
      action: input.action,
      alertType: input.alertType as AlertType,
      customGraphId,
      actionParams: { ...delivery, ...rule },
    });
    return {
      name: built.name,
      action: built.action,
      triggerKind: TriggerKind.ALERT,
      alertType: built.alertType,
      filters: built.filters,
      filterQuery: null,
      customGraphId: built.customGraphId,
      actionParams: built.actionParams as Prisma.InputJsonValue,
      ...this.templateColumns(input.templates),
    };
  }

  private reportCreateData({
    id,
    projectId,
    input,
    report,
    delivery,
    filterQuery,
  }: {
    id: string;
    projectId: string;
    input: PublicApiCreateInput;
    report: ReportActionParams;
    delivery: Record<string, unknown>;
    filterQuery: string | null;
  }): Omit<Prisma.TriggerUncheckedCreateInput, "id" | "projectId"> {
    this.readReport({ action: input.action, report });
    const built = buildReportTriggerData({
      id,
      name: input.name,
      projectId,
      action: input.action,
      actionParams: { ...delivery, ...report },
    });
    return {
      name: built.name,
      action: built.action,
      triggerKind: TriggerKind.REPORT,
      filters: built.filters,
      customGraphId: null,
      // A trace-query report sends the traces its query selects; a graph or
      // dashboard report has no trace query, so the column is cleared.
      filterQuery: report.source.kind === "traceQuery" ? filterQuery : null,
      actionParams: built.actionParams as Prisma.InputJsonValue,
      ...this.templateColumns(input.templates),
    };
  }

  async update({
    projectId,
    triggerId,
    input,
  }: {
    projectId: string;
    triggerId: string;
    input: PublicApiUpdateInput;
  }): Promise<Trigger> {
    const stored = await this.getById({ projectId, triggerId });
    this.assertWhatIsFixedIsUnchanged({ stored, input });
    if (input.templates) validateTemplateDraft(input.templates);

    const isGraphAlert = stored.customGraphId !== null;
    const data: Prisma.TriggerUncheckedUpdateInput = {
      ...this.templateColumns(input.templates),
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
      ...(input.message !== undefined ? { message: input.message } : {}),
      ...(input.alertType !== undefined ? { alertType: input.alertType } : {}),
      ...(input.traceDebounceMs !== undefined
        ? { traceDebounceMs: input.traceDebounceMs }
        : {}),
      ...this.conditionUpdate({ projectId, stored, input }),
      ...(await this.actionParamsUpdate({ projectId, stored, input })),
    };

    // A pinned cadence is stated on every save that could have moved the row
    // into its class, so the stored value cannot outlive what reads it.
    const cadence = resolveNotificationCadenceForUpdate({
      action: stored.action,
      requested: input.notificationCadence,
      isGraphAlert,
    });
    if (cadence !== undefined) data.notificationCadence = cadence;

    const updated = await this.triggers.update({ triggerId, projectId, data });

    if (stored.triggerKind === TriggerKind.REPORT) {
      await this.syncReportSchedule({ projectId, trigger: updated });
    }

    await this.triggers.invalidate(projectId);
    return updated;
  }

  /** The channel an automation delivers on and the kind of automation it is
   *  are both fixed once it exists. A save that states a different one is
   *  refused rather than having the field ignored. */
  private assertWhatIsFixedIsUnchanged({
    stored,
    input,
  }: {
    stored: Trigger;
    input: PublicApiUpdateInput;
  }): void {
    if (input.action !== undefined && input.action !== stored.action) {
      throw new TriggerActionImmutableError(stored.action);
    }
    const kind = stored.triggerKind.toLowerCase();
    if (input.graphAlert !== undefined && stored.customGraphId === null) {
      throw new TriggerKindImmutableError(kind);
    }
    if (
      input.report !== undefined &&
      stored.triggerKind !== TriggerKind.REPORT
    ) {
      throw new TriggerKindImmutableError(kind);
    }
  }

  /** What the automation is about, as far as this save states it. */
  private conditionUpdate({
    projectId,
    stored,
    input,
  }: {
    projectId: string;
    stored: Trigger;
    input: PublicApiUpdateInput;
  }): Prisma.TriggerUncheckedUpdateInput {
    const query =
      input.filterQuery !== undefined
        ? this.readFilterQuery({ filterQuery: input.filterQuery, projectId })
        : (stored.filterQuery ?? null);
    const data: Prisma.TriggerUncheckedUpdateInput =
      input.filterQuery !== undefined ? { filterQuery: query } : {};
    if (input.filters === undefined) return data;

    const filters = this.sanitizeFilters(input.filters);
    // Editing is the other way to end up with a match-everything automation:
    // create it with a real condition, then clear it here. The stored row
    // decides whether that is allowed — an automation whose condition lives in
    // its query keeps a legitimately empty structured set, and alerts and
    // reports have no trace condition to require at all.
    if (
      !hasActionableTriggerFilters(filters) &&
      stored.triggerKind === TriggerKind.AUTOMATION &&
      (query ?? "").trim() === ""
    ) {
      throw new TriggerFiltersRequiredError();
    }
    return { ...data, filters: JSON.stringify(filters) };
  }

  /**
   * The delivery configuration and the rule an automation fires by share one
   * column, so a save that touches either states both halves and the stored
   * row supplies the one this call did not.
   */
  private async actionParamsUpdate({
    projectId,
    stored,
    input,
  }: {
    projectId: string;
    stored: Trigger;
    input: PublicApiUpdateInput;
  }): Promise<Prisma.TriggerUncheckedUpdateInput> {
    const rule = await this.resolveStoredRule({ stored, input });

    if (input.actionParams !== undefined) {
      // The channel is the stored row's: an update states a delivery
      // configuration for the channel this automation already delivers on.
      await this.assertChannelEnabled({ action: stored.action, projectId });
      return {
        actionParams: (await persistPublicApiActionParams({
          action: stored.action,
          incoming: { ...input.actionParams, ...(rule ?? {}) },
          stored: stored.actionParams,
        })) as Prisma.InputJsonValue,
      };
    }
    if (rule === undefined) return {};
    // Only the rule changed. The delivery half is already in its at-rest form
    // on the row, so it stays exactly as it is rather than making a round trip
    // through the channel's persist hook, which reads wire shapes and not
    // stored ones.
    return {
      actionParams: {
        ...((stored.actionParams ?? {}) as Record<string, unknown>),
        ...rule,
      } as Prisma.InputJsonValue,
    };
  }

  /** Resume or pause an automation. A report's schedule does not live on the
   *  row — pausing retires its calendar entry and resuming puts it back, so a
   *  paused report stops claiming its slot every cadence. */
  async setActive({
    projectId,
    triggerId,
    active,
  }: {
    projectId: string;
    triggerId: string;
    active: boolean;
  }): Promise<Trigger> {
    const stored = await this.getById({ projectId, triggerId });
    const updated = await this.triggers.update({
      triggerId,
      projectId,
      data: {
        active,
        // Resuming clears the platform's pause record, so a running automation
        // cannot keep claiming it was paused for runaway volume.
        ...(active ? { pausedReason: null, pausedAt: null } : {}),
      },
    });

    if (stored.triggerKind === TriggerKind.REPORT) {
      if (active)
        await this.syncReportSchedule({ projectId, trigger: updated });
      else await this.triggers.removeReportSchedule({ projectId, triggerId });
    }

    await this.triggers.invalidate(projectId);
    return updated;
  }

  async softDelete({
    projectId,
    triggerId,
  }: {
    projectId: string;
    triggerId: string;
  }): Promise<Trigger> {
    await this.getById({ projectId, triggerId });
    const deleted = await this.triggers.softDeleteById({
      triggerId,
      projectId,
    });
    await this.triggers.removeReportSchedule({ projectId, triggerId });
    await this.triggers.invalidate(projectId);
    return deleted;
  }

  /** What this automation has been doing: its fires, newest first. Metadata
   *  only — no trace ids and no trace content, the same contract the drawer's
   *  "Recent fires" panel reads. */
  async getFireHistory({
    projectId,
    triggerId,
    limit,
  }: {
    projectId: string;
    triggerId: string;
    limit: number;
  }) {
    await this.getById({ projectId, triggerId });
    return this.deps.fireHistory.getAllRecentFiresForTrigger({
      projectId,
      triggerId,
      limit,
    });
  }

  /**
   * Send this automation's message to the destination it is configured with.
   *
   * The destination is the saved one, never one supplied by the caller: a test
   * fire is proof that a configured automation delivers, not a way to send a
   * message anywhere. That also keeps this off the open-relay shape ADR-031
   * closed on the dashboard path, where the recipient is the signed-in user
   * rather than anything the request carried.
   */
  async testFire({
    projectId,
    triggerId,
  }: {
    projectId: string;
    triggerId: string;
  }): Promise<TestFireResult> {
    const trigger = await this.getById({ projectId, triggerId });
    await this.assertChannelEnabled({ action: trigger.action, projectId });
    const project = await this.deps.resolveProject(projectId);
    const graphAlert = extractGraphAlertFromTriggerRow(trigger.actionParams);
    const report = extractReportFromTriggerRow(trigger.actionParams);

    return this.deps.testFire({
      trigger: { name: trigger.name, alertType: trigger.alertType },
      project,
      draft: {
        slackTemplateType: trigger.slackTemplateType,
        slackTemplate: trigger.slackTemplate,
        emailSubjectTemplate: trigger.emailSubjectTemplate,
        emailBodyTemplate: trigger.emailBodyTemplate,
      },
      graphAlert: graphAlert
        ? {
            metricLabel: graphAlert.seriesName,
            operator: graphAlert.operator,
            threshold: graphAlert.threshold,
            timePeriodMinutes: graphAlert.timePeriod,
          }
        : null,
      report: report ? { sourceKind: report.source.kind } : null,
      ...this.savedDestination(trigger),
    });
  }

  /** Where this automation's test fire goes: the destination on the saved row,
   *  read the way a real delivery reads it. */
  private savedDestination(
    trigger: Trigger,
  ): Pick<
    PublicApiTestFireInput,
    | "channel"
    | "recipients"
    | "webhook"
    | "botDestination"
    | "webhookDestination"
  > {
    const params = (trigger.actionParams ?? {}) as Record<string, unknown>;

    switch (trigger.action) {
      case TriggerAction.SEND_EMAIL: {
        const recipients = (params.members ?? []) as string[];
        if (recipients.length === 0) {
          throw new TestFireUnavailableError(
            "email",
            "This automation has no email recipients to test-fire to.",
          );
        }
        return { channel: "email", recipients, webhook: null };
      }
      case TriggerAction.SEND_SLACK_MESSAGE:
        return this.savedSlackDestination(params);
      case TriggerAction.SEND_WEBHOOK:
        return this.savedWebhookDestination(
          params as WebhookStoredActionParams,
        );
      default:
        // Dataset rows and annotation-queue items are written, not delivered:
        // there is no message to send and nothing a test fire could prove.
        throw new TestFireUnavailableError(
          "email",
          "This automation writes a record rather than sending a message, so " +
            "there is nothing to test-fire.",
        );
    }
  }

  /** A Slack automation reaches Slack the way it is configured to: as the bot
   *  in its channel where a token is stored, otherwise through its incoming
   *  webhook. */
  private savedSlackDestination(
    params: Record<string, unknown>,
  ): Pick<
    PublicApiTestFireInput,
    "channel" | "recipients" | "webhook" | "botDestination"
  > {
    const botToken = decryptSlackBotToken(params as SlackActionParams);
    const channelId = (params.slackChannelId ?? "") as string;
    if (botToken && channelId) {
      return {
        channel: "slack",
        recipients: [],
        webhook: null,
        botDestination: { token: botToken, channel: channelId },
      };
    }
    const webhook = (params.slackWebhook ?? "") as string;
    if (!webhook) {
      throw new TestFireUnavailableError(
        "slack",
        "This automation has no Slack destination to test-fire to.",
      );
    }
    return { channel: "slack", recipients: [], webhook };
  }

  /** The full request a real delivery would make, signed the same way, so a
   *  test fire can be pointed at the receiver's own verification. */
  private savedWebhookDestination(
    stored: WebhookStoredActionParams,
  ): Pick<
    PublicApiTestFireInput,
    "channel" | "recipients" | "webhook" | "webhookDestination"
  > {
    if (!stored.url) {
      throw new TestFireUnavailableError(
        "webhook",
        "This automation has no destination to test-fire to.",
      );
    }
    return {
      channel: "webhook",
      recipients: [],
      webhook: null,
      webhookDestination: {
        url: stored.url,
        method: stored.method ?? "POST",
        headers: decryptWebhookHeaders(stored),
        bodyTemplate: stored.bodyTemplate ?? null,
        signingSecrets: decryptWebhookSigningSecrets(stored),
      },
    };
  }

  /** The four Liquid template columns, stated only when the caller stated
   *  them: an update that says nothing about templates leaves them alone. */
  private templateColumns(templates: TemplateDraft | undefined) {
    if (!templates) return {};
    return {
      slackTemplateType: templates.slackTemplateType ?? null,
      slackTemplate: templates.slackTemplate ?? null,
      emailSubjectTemplate: templates.emailSubjectTemplate ?? null,
      emailBodyTemplate: templates.emailBodyTemplate ?? null,
    };
  }

  /** The rule half of `actionParams` for an update: the incoming one where the
   *  caller stated it, the stored one where a delivery-only save would
   *  otherwise drop it, and nothing at all for a plain trace automation. */
  private async resolveStoredRule({
    stored,
    input,
  }: {
    stored: Trigger;
    input: PublicApiUpdateInput;
  }): Promise<Record<string, unknown> | undefined> {
    const isAlert = stored.customGraphId !== null;
    const isReport = stored.triggerKind === TriggerKind.REPORT;
    const statedRule = isAlert ? input.graphAlert : input.report;
    // A trace automation has no rule, and a save that states neither a rule
    // nor a delivery configuration leaves the stored one where it is.
    if (!isAlert && !isReport) return undefined;
    if (statedRule === undefined && input.actionParams === undefined) {
      return undefined;
    }
    return isAlert
      ? this.alertRule({ stored, stated: input.graphAlert })
      : this.reportRule({ stored, stated: input.report });
  }

  private alertRule({
    stored,
    stated,
  }: {
    stored: Trigger;
    stated: GraphAlertActionParams | undefined;
  }): Record<string, unknown> {
    const rule = stated ?? this.storedGraphAlertRule(stored);
    if (!rule) {
      throw new GraphAlertIncompleteError(
        "graphAlert",
        "This alert has no rule to fire by. State the series, the operator, " +
          "the threshold and the time window.",
      );
    }
    return { ...rule };
  }

  private reportRule({
    stored,
    stated,
  }: {
    stored: Trigger;
    stated: ReportActionParams | undefined;
  }): Record<string, unknown> {
    const report = stated ?? this.storedReport(stored);
    if (!report) throw new ReportChannelUnsupportedError();
    this.readReport({ action: stored.action, report });
    return { ...report };
  }

  /** The rule half of a stored alert, without the delivery keys the row
   *  parser carries alongside it. */
  private storedGraphAlertRule(
    stored: Trigger,
  ): GraphAlertActionParams | undefined {
    const parsed = graphAlertActionParamsSchema.safeParse(
      stored.actionParams ?? {},
    );
    return parsed.success ? parsed.data : undefined;
  }

  /** The report half of a stored row: what it renders and when. */
  private storedReport(stored: Trigger): ReportActionParams | undefined {
    const parsed = extractReportFromTriggerRow(stored.actionParams);
    if (!parsed) return undefined;
    return {
      source: parsed.source,
      schedule: parsed.schedule,
      compareToPrevious: parsed.compareToPrevious,
    };
  }

  private async syncReportSchedule({
    projectId,
    trigger,
  }: {
    projectId: string;
    trigger: Trigger;
  }): Promise<void> {
    const report = extractReportFromTriggerRow(trigger.actionParams);
    if (!report || !trigger.active) {
      await this.triggers.removeReportSchedule({
        projectId,
        triggerId: trigger.id,
      });
      return;
    }
    await this.triggers.syncReportSchedule({
      projectId,
      triggerId: trigger.id,
      cron: report.schedule.cron,
      timezone: report.schedule.timezone,
    });
  }

  /** A graph alert needs a channel that notifies, a rule to fire by, a
   *  severity to fire at, and a graph in this project. */
  private async readGraphAlert({
    projectId,
    action,
    alertType,
    customGraphId,
    graphAlert,
  }: {
    projectId: string;
    action: TriggerAction;
    alertType: AlertType | null | undefined;
    customGraphId: string;
    graphAlert: GraphAlertActionParams | undefined;
  }): Promise<GraphAlertActionParams> {
    if (!NOTIFY_TRIGGER_ACTIONS.has(action)) {
      throw new GraphAlertIncompleteError(
        "action",
        "An alert notifies when a metric crosses a threshold, so it delivers " +
          "by email, to Slack or to an endpoint.",
      );
    }
    if (!graphAlert) {
      throw new GraphAlertIncompleteError(
        "graphAlert",
        "State the series, the operator, the threshold and the time window " +
          "this alert fires on.",
      );
    }
    if (!alertType) {
      throw new GraphAlertIncompleteError(
        "alertType",
        "State the severity this alert fires at.",
      );
    }
    await this.assertGraphInProject({ projectId, customGraphId });
    return graphAlert;
  }

  /** A report renders a message on a schedule, so it delivers on a channel
   *  that can carry one. */
  private readReport({
    action,
    report,
  }: {
    action: TriggerAction;
    report: ReportActionParams;
  }): ReportActionParams {
    if (
      action !== TriggerAction.SEND_EMAIL &&
      action !== TriggerAction.SEND_SLACK_MESSAGE
    ) {
      throw new ReportChannelUnsupportedError();
    }
    return report;
  }

  /** An alert fires on a graph in its own project. Without this a caller could
   *  attach one to another tenant's graph. */
  private async assertGraphInProject({
    projectId,
    customGraphId,
  }: {
    projectId: string;
    customGraphId: string;
  }): Promise<void> {
    const exists = await this.deps.graphs.existsInProject({
      customGraphId,
      projectId,
    });
    if (!exists) throw new GraphNotFoundError();
  }

  /** The trace query the automation is about, normalised and dry-run through
   *  the compiler. A query that cannot be read is refused at the save; left to
   *  dispatch it would fail closed and the automation would quietly match
   *  nothing. Whitespace collapses to none, the same as omitting it. */
  private readFilterQuery({
    filterQuery,
    projectId,
  }: {
    filterQuery: string | null | undefined;
    projectId: string;
  }): string | null {
    const query = filterQuery?.trim() ?? "";
    if (query === "") return null;
    try {
      translateFilterToClickHouse(query, projectId, { from: 0, to: 0 });
    } catch (error) {
      throw new TriggerFilterQueryInvalidError(
        error instanceof Error ? error.message : "could not parse the query",
      );
    }
    return query;
  }

  /** Conditions naming fields this platform no longer filters on are dropped.
   *  An automation left with nothing but those has no usable condition at all,
   *  which is a different answer from having written none. */
  private sanitizeFilters(
    filters: Record<string, TriggerFilterValue>,
  ): Record<string, TriggerFilterValue> {
    const { sanitized, unknownFields } = sanitizeTriggerFilters(filters);
    if (unknownFields.length > 0 && Object.keys(sanitized).length === 0) {
      throw new TriggerFiltersUnsupportedError(unknownFields);
    }
    return sanitized;
  }

  /** The webhook channel ships behind a release flag (ADR-040 §7). Gating the
   *  save and not only the picker is what makes the flag hold for a caller who
   *  never sees the picker. Resolved per project, like every other gate on
   *  this channel, so the dashboard and the API agree during a rollout. */
  private async assertChannelEnabled({
    action,
    projectId,
  }: {
    action: TriggerAction;
    projectId: string;
  }): Promise<void> {
    if (action !== TriggerAction.SEND_WEBHOOK) return;
    const enabled = await featureFlagService.isEnabled(
      "release_webhook_automations",
      { distinctId: projectId, projectId },
    );
    if (!enabled) throw new TriggerChannelNotEnabledError("webhook");
  }
}

export interface PublicApiCreateInput {
  name: string;
  action: TriggerAction;
  actionParams: Record<string, unknown>;
  filters?: Record<string, TriggerFilterValue>;
  filterQuery?: string | null;
  message?: string;
  alertType?: AlertType;
  customGraphId?: string;
  graphAlert?: GraphAlertActionParams;
  report?: ReportActionParams;
  templates?: TemplateDraft;
  notificationCadence?: NotificationCadence;
  traceDebounceMs?: number;
}

export interface PublicApiUpdateInput {
  /** Accepted so a caller that writes the whole read response back is told
   *  what happened, rather than having the field silently ignored. */
  action?: TriggerAction;
  name?: string;
  active?: boolean;
  message?: string | null;
  alertType?: AlertType | null;
  filters?: Record<string, TriggerFilterValue>;
  filterQuery?: string | null;
  actionParams?: Record<string, unknown>;
  graphAlert?: GraphAlertActionParams;
  report?: ReportActionParams;
  templates?: TemplateDraft;
  notificationCadence?: NotificationCadence;
  traceDebounceMs?: number;
}

/** What this service hands the test-fire path. The destination always comes
 *  from the saved row, so nothing here is caller-supplied. */
export interface PublicApiTestFireInput {
  channel: "email" | "slack" | "webhook";
  trigger: { name: string; alertType: AlertType | null };
  project: DraftProject;
  draft: TemplateDraft;
  recipients: string[];
  webhook: string | null;
  botDestination?: { token: string; channel: string } | null;
  webhookDestination?: TestFireWebhookDestination | null;
  graphAlert?: {
    metricLabel?: string;
    operator?: string;
    threshold?: number;
    timePeriodMinutes?: number;
  } | null;
  report?: { sourceKind: "traceQuery" | "customGraph" | "dashboard" } | null;
}

import {
  DEFAULT_TRACE_DEBOUNCE_MS,
  type NotificationCadence,
} from "@langwatch/automations/cadences";
import { DEFAULT_WEBHOOK_CONTENT_TYPE } from "@langwatch/automations/providers/webhook";
import { generate as ksuid } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import type { AlertType, Prisma, Trigger } from "~/generated/prisma/client";
import { TriggerAction, TriggerKind } from "~/generated/prisma/client";
import { hasActionableTriggerFilters } from "~/server/filters/triggerFilter.matcher";
import {
  sanitizeTriggerFilters,
  type TriggerFilterValue,
} from "~/server/filters/types";
import { rateLimit } from "~/server/rateLimit";
import { KSUID_RESOURCES } from "~/utils/constants";
import { translateFilterToClickHouse } from "../traces/filter-to-clickhouse";
import type { AutomationCustomGraphService } from "./custom-graph.service";
import { NOTIFY_TRIGGER_ACTIONS } from "./dispatch/triggerActionDispatch";
import {
  GraphAlertIncompleteError,
  GraphNotFoundError,
  ReportChannelUnsupportedError,
  ReportIncompleteError,
  TestFireUnavailableError,
  TriggerActionImmutableError,
  TriggerActionParamsUnknownFieldsError,
  TriggerFilterQueryInvalidError,
  TriggerFiltersRequiredError,
  TriggerFiltersUnsupportedError,
  TriggerGraphImmutableError,
  TriggerKindImmutableError,
  TriggerNotFoundError,
  TriggerRuleFieldsMisplacedError,
  TriggerTestFireRateLimitedError,
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
import { actionParamsSchemaFor } from "./providers/registry";
import {
  decryptWebhookHeaders,
  decryptWebhookSigningSecrets,
  type WebhookStoredActionParams,
} from "./providers/webhook/server";
import {
  buildReportTriggerData,
  extractReportFromTriggerRow,
  type ReportActionParams,
  reportActionParamsSchema,
} from "./report.builder";
import type {
  TriggerFireCursor,
  TriggerFirePage,
} from "./repositories/trigger-fire-history.repository";
import { findSlackDestination } from "./slack-integration/slack-destination-resolver";
import {
  type SlackIntegrationService,
  withKeptLegacySlackSecret,
} from "./slack-integration/slack-integration.service";
import type { TriggerService } from "./trigger.service";
import type { TriggerFilterValidationService } from "./trigger-filter-validation.service";
import type { TriggerFireHistoryService } from "./trigger-fire-history.service";
import {
  deliveryFieldNames,
  persistPublicApiActionParams,
} from "./trigger-redaction";
import type {
  DraftProject,
  TemplateDraft,
  TestFireResult,
  TestFireWebhookDestination,
} from "./trigger-template.service";
import { validateTemplateDraft } from "./trigger-template.service";

/** The same window the dashboard's test fire runs on, so a project cannot make
 *  LangWatch send more often through the API than through the drawer. */
const TEST_FIRE_WINDOW_SECONDS = 60;
const TEST_FIRE_MAX_PER_WINDOW = 10;

/** Where each kind of automation states the rule it fires by, read off the
 *  schema that validates it so the two cannot drift. */
const RULE_FIELD_NAMES: Record<"graphAlert" | "report", Set<string>> = {
  graphAlert: new Set(Object.keys(graphAlertActionParamsSchema.shape)),
  report: new Set(Object.keys(reportActionParamsSchema.shape)),
};

const logger = createLogger("langwatch:automations:public-api-trigger");

/**
 * What the public API is allowed to write, and on what terms.
 *
 * An automation written over the API is the same row the dashboard writes and
 * the same row the dispatcher reads, so it is held to the same rules rather
 * than to whatever the wire schema happened to accept: a delivery
 * configuration its channel recognises, a destination that is safe to send to,
 * conditions that select something, a trace query the platform can read, a
 * graph that belongs to this project, and the cadence a new notification starts
 * on.
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
      filterValidation: Pick<TriggerFilterValidationService, "assertWritable">;
      testFire: (input: PublicApiTestFireInput) => Promise<TestFireResult>;
      resolveProject: (projectId: string) => Promise<DraftProject>;
      /**
       * ADR-093 §5a: saves point Slack params at a connection (a legacy secret
       * becomes one), and a test fire resolves the connection a delivery uses.
       */
      slackConnections: Pick<
        SlackIntegrationService,
        "connectActionParams" | "findUsableSecret"
      >;
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
    actorId,
  }: {
    projectId: string;
    input: PublicApiCreateInput;
    /** Who a Slack connection created from a legacy secret is attributed to. */
    actorId?: string;
  }): Promise<Trigger> {
    if (input.templates) validateTemplateDraft(input.templates);

    const isGraphAlert = !!input.customGraphId;
    const isReport = !isGraphAlert && !!input.report;
    const id = ksuid(KSUID_RESOURCES.TRIGGER).toString();
    const data = await this.buildCreateData({
      id,
      projectId,
      input,
      actorId: actorId ?? apiActorFallback(projectId),
    });

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
    actorId,
  }: {
    id: string;
    projectId: string;
    input: PublicApiCreateInput;
    actorId: string;
  }): Promise<Omit<Prisma.TriggerUncheckedCreateInput, "id" | "projectId">> {
    const filterQuery = this.readFilterQuery({
      filterQuery: input.filterQuery,
      projectId,
    });
    const filters = this.sanitizeFilters(input.filters ?? {});
    this.assertActionParamsFieldsAreThisChannels({
      action: input.action,
      actionParams: input.actionParams,
      kind: input.customGraphId
        ? TriggerKind.ALERT
        : input.report
          ? TriggerKind.REPORT
          : TriggerKind.AUTOMATION,
    });
    // Every refusal comes before the delivery is persisted: a legacy Slack
    // secret is stored as a connection there, and a refused save stores none.
    const delivery = () =>
      this.persistedCreateDelivery({ projectId, input, actorId });

    if (input.customGraphId) {
      const rule = await this.readGraphAlert({
        projectId,
        action: input.action,
        alertType: input.alertType,
        customGraphId: input.customGraphId,
        graphAlert: input.graphAlert,
      });
      return this.graphAlertCreateData({
        id,
        projectId,
        input,
        customGraphId: input.customGraphId,
        rule,
        delivery: await delivery(),
      });
    }
    if (input.report) {
      this.readReport({ action: input.action, report: input.report });
      return this.reportCreateData({
        id,
        projectId,
        input,
        report: input.report,
        delivery: await delivery(),
        filterQuery,
      });
    }

    // A trace automation must say which traces it is about; an alert's
    // condition is its threshold and a report's is its schedule, and both
    // persist an empty condition set by construction.
    await this.assertCreatedConditionWritable({
      projectId,
      filterQuery,
      filters,
    });
    const traceDelivery = await delivery();
    return {
      name: input.name,
      action: input.action,
      triggerKind: TriggerKind.AUTOMATION,
      alertType: input.alertType ?? null,
      // A trace-query automation supersedes the structured conditions, so
      // the stored set is emptied and the dispatcher reads the query.
      filters: filterQuery !== null ? "{}" : JSON.stringify(filters),
      filterQuery,
      actionParams: traceDelivery as Prisma.InputJsonValue,
      ...this.templateColumns(input.templates),
    };
  }

  /** A create's delivery in its at-rest form, Slack pointed at a connection. */
  private async persistedCreateDelivery({
    projectId,
    input,
    actorId,
  }: {
    projectId: string;
    input: PublicApiCreateInput;
    actorId: string;
  }): Promise<Record<string, unknown>> {
    return (await persistPublicApiActionParams({
      action: input.action,
      incoming: await this.connectSlackParams({
        action: input.action,
        projectId,
        actorId,
        actionParams: input.actionParams,
      }),
    })) as Record<string, unknown>;
  }

  /** Structured conditions a query does not supersede are the condition, so
   *  they must select something and be written in a shape that can match. */
  private async assertCreatedConditionWritable({
    projectId,
    filterQuery,
    filters,
  }: {
    projectId: string;
    filterQuery: string | null;
    filters: Record<string, TriggerFilterValue>;
  }): Promise<void> {
    if (filterQuery !== null) return;
    if (!hasActionableTriggerFilters(filters)) {
      throw new TriggerFiltersRequiredError();
    }
    await this.deps.filterValidation.assertWritable({ projectId, filters });
  }

  private graphAlertCreateData({
    id,
    projectId,
    input,
    customGraphId,
    rule,
    delivery,
  }: {
    id: string;
    projectId: string;
    input: PublicApiCreateInput;
    customGraphId: string;
    rule: GraphAlertActionParams;
    delivery: Record<string, unknown>;
  }): Omit<Prisma.TriggerUncheckedCreateInput, "id" | "projectId"> {
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
    actorId,
  }: {
    projectId: string;
    triggerId: string;
    input: PublicApiUpdateInput;
    /** Who a Slack connection created from a legacy secret is attributed to. */
    actorId?: string;
  }): Promise<Trigger> {
    const stored = await this.getById({ projectId, triggerId });
    this.assertWhatIsFixedIsUnchanged({ stored, input });
    if (input.templates) validateTemplateDraft(input.templates);

    const isGraphAlert = stored.customGraphId !== null;
    const data: Prisma.TriggerUncheckedUpdateInput = {
      ...this.templateColumns(input.templates),
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
      // Resuming clears the pause record, the same as `setActive` does.
      ...(input.active === true ? { pausedReason: null, pausedAt: null } : {}),
      ...(input.message !== undefined ? { message: input.message } : {}),
      ...(input.alertType !== undefined ? { alertType: input.alertType } : {}),
      ...(input.traceDebounceMs !== undefined
        ? { traceDebounceMs: input.traceDebounceMs }
        : {}),
      ...(await this.conditionUpdate({ projectId, stored, input })),
      ...(await this.actionParamsUpdate({
        projectId,
        stored,
        input,
        actorId: actorId ?? apiActorFallback(projectId),
      })),
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

  /** The channel an automation delivers on, the kind of automation it is and
   *  the graph an alert watches are all fixed once it exists. A save that
   *  states a different one is refused rather than having the field ignored. */
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
    this.assertGraphIsUnchanged({ stored, stated: input.customGraphId, kind });
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

  /** A stated graph must be the one stored. Adding or removing a graph would
   *  turn the automation into a different kind; naming another graph would
   *  move an alert out of the graph slot it owns. */
  private assertGraphIsUnchanged({
    stored,
    stated,
    kind,
  }: {
    stored: Trigger;
    stated: string | null | undefined;
    kind: string;
  }): void {
    if (stated === undefined || stated === stored.customGraphId) return;
    if (stored.customGraphId === null || stated === null) {
      throw new TriggerKindImmutableError(kind);
    }
    throw new TriggerGraphImmutableError(stored.customGraphId);
  }

  /**
   * What the automation is about, as far as this save states it. A save that
   * touches the condition is judged on the condition it leaves behind, so
   * clearing the query of a query-only automation is refused the way a create
   * with no condition is. Alerts and reports have no trace condition.
   */
  private async conditionUpdate({
    projectId,
    stored,
    input,
  }: {
    projectId: string;
    stored: Trigger;
    input: PublicApiUpdateInput;
  }): Promise<Prisma.TriggerUncheckedUpdateInput> {
    if (input.filterQuery === undefined && input.filters === undefined) {
      return {};
    }
    const query =
      input.filterQuery !== undefined
        ? this.readFilterQuery({ filterQuery: input.filterQuery, projectId })
        : (stored.filterQuery ?? null);
    const filters =
      input.filters !== undefined
        ? this.sanitizeFilters(input.filters)
        : storedFilters(stored);
    assertTraceAutomationHasCondition({ stored, query, filters });
    if (input.filters !== undefined) {
      await this.deps.filterValidation.assertWritable({ projectId, filters });
    }
    return {
      ...(input.filterQuery !== undefined ? { filterQuery: query } : {}),
      ...(input.filters !== undefined
        ? { filters: JSON.stringify(filters) }
        : {}),
    };
  }

  /**
   * The delivery configuration and the rule an automation fires by share one
   * column, so a save that touches either states both halves and the stored
   * row supplies the one this call did not.
   *
   * The stored rule is the base. A save that only replaces the delivery
   * configuration says nothing about the rule, and a row whose rule then went
   * missing would stop firing on a save that never mentioned it — including a
   * row whose rule the automation's kind does not advertise.
   *
   * Only a rule that parses as one is carried across. Anything else left in
   * that half of the stored column is the channel's own at-rest business —
   * ciphertext under names no wire schema publishes — and the provider's hook
   * has just decided what becomes of it.
   */
  private async actionParamsUpdate({
    projectId,
    stored,
    input,
    actorId,
  }: {
    projectId: string;
    stored: Trigger;
    input: PublicApiUpdateInput;
    actorId: string;
  }): Promise<Prisma.TriggerUncheckedUpdateInput> {
    const statedRule = await this.resolveStoredRule({ stored, input });
    const rule =
      statedRule === undefined && input.actionParams === undefined
        ? undefined
        : {
            ...(this.storedGraphAlertRule(stored) ??
              this.storedReport(stored) ??
              {}),
            ...(statedRule ?? {}),
          };

    if (input.actionParams !== undefined) {
      // The channel is the stored row's: an update states a delivery
      // configuration for the channel this automation already delivers on, and
      // is held to that channel's fields rather than to whichever shape the
      // payload resembles.
      this.assertActionParamsFieldsAreThisChannels({
        action: stored.action,
        actionParams: input.actionParams,
        kind:
          stored.customGraphId !== null
            ? TriggerKind.ALERT
            : stored.triggerKind,
      });
      return {
        actionParams: (await persistPublicApiActionParams({
          action: stored.action,
          incoming: {
            ...(await this.connectSlackParams({
              action: stored.action,
              projectId,
              actorId,
              actionParams: input.actionParams,
              stored: stored.actionParams,
            })),
            ...(rule ?? {}),
          },
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

  /** One page of what this automation has been doing, newest first; the
   *  cursor resumes after the last fire of the page before. Metadata only — no
   *  trace ids and no trace content, the contract the drawer's history reads. */
  async getFireHistory({
    projectId,
    triggerId,
    limit,
    cursor,
  }: {
    projectId: string;
    triggerId: string;
    limit: number;
    cursor: TriggerFireCursor | null;
  }): Promise<TriggerFirePage> {
    await this.getById({ projectId, triggerId });
    return this.deps.fireHistory.getFireHistoryPage({
      projectId,
      triggerId,
      limit,
      cursor,
    });
  }

  /**
   * Send this automation's message to the destination it is configured with.
   *
   * The destination is the saved one, never one supplied by the request. That
   * is not by itself what keeps this off the open-relay shape ADR-031 closed
   * on the dashboard path: there the recipient is the signed-in user and so is
   * not the caller's to choose, while here the same caller can set an
   * automation's recipients and then fire it. What bounds it is the cap below,
   * which is the volume limit on how often a project can make LangWatch send —
   * an email through the shared provider, or a request from our workers at an
   * arbitrary destination (ADR-040 §4).
   */
  async testFire({
    projectId,
    triggerId,
  }: {
    projectId: string;
    triggerId: string;
  }): Promise<TestFireResult> {
    const trigger = await this.getById({ projectId, triggerId });
    await this.assertTestFireAllowed({ action: trigger.action, projectId });
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
      ...(await this.savedDestination(trigger)),
    });
  }

  /** Where this automation's test fire goes: the destination on the saved row,
   *  read the way a real delivery reads it. */
  private async savedDestination(
    trigger: Trigger,
  ): Promise<
    Pick<
      PublicApiTestFireInput,
      | "channel"
      | "recipients"
      | "webhook"
      | "botDestination"
      | "webhookDestination"
    >
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
        return this.savedSlackDestination({
          params,
          projectId: trigger.projectId,
        });
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

  /**
   * Point Slack params at a connection before the provider persists them. On
   * an update, a secret the row still stores and the caller did not retype is
   * moved into a connection too, never written back (ADR-093 §5a).
   */
  private async connectSlackParams({
    action,
    projectId,
    actorId,
    actionParams,
    stored,
  }: {
    action: TriggerAction;
    projectId: string;
    actorId: string;
    actionParams: Record<string, unknown>;
    stored?: unknown;
  }): Promise<Record<string, unknown>> {
    if (action !== TriggerAction.SEND_SLACK_MESSAGE) return actionParams;
    return this.deps.slackConnections.connectActionParams({
      projectId,
      actorId,
      actionParams:
        stored === undefined
          ? actionParams
          : withKeptLegacySlackSecret({ actionParams, stored }),
    });
  }

  private async savedSlackDestination({
    params,
    projectId,
  }: {
    params: Record<string, unknown>;
    projectId: string;
  }): Promise<
    Pick<
      PublicApiTestFireInput,
      "channel" | "recipients" | "webhook" | "botDestination"
    >
  > {
    // The same resolution a real delivery takes (ADR-093 §5a), so the surface
    // is the connection's kind and a test fire proves what delivery will use.
    const destination = await findSlackDestination({
      actionParams: params,
      projectId,
      connections: this.deps.slackConnections,
    });
    if (!destination) {
      throw new TestFireUnavailableError(
        "slack",
        "This automation has no Slack connection to test-fire to.",
      );
    }
    if (destination.kind === "webhook") {
      return { channel: "slack", recipients: [], webhook: destination.url };
    }
    if (!destination.channel) {
      // Fail closed: a bot connection without a channel has nowhere to post.
      throw new TestFireUnavailableError(
        "slack",
        "This automation delivers through a Slack connection, and no " +
          "channel resolves for it.",
      );
    }
    return {
      channel: "slack",
      recipients: [],
      webhook: null,
      botDestination: {
        token: destination.token,
        channel: destination.channel,
      },
    };
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
        contentType: stored.contentType ?? DEFAULT_WEBHOOK_CONTENT_TYPE,
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
      throw new GraphAlertIncompleteError({
        field: "graphAlert",
        reason:
          "This alert has no rule to fire by. State the series, the " +
          "operator, the threshold and the time window.",
      });
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
    // Nothing stated, and the stored configuration no longer reads as a
    // report. What the caller has to do is state one — which channel it
    // delivers on is not the problem here.
    const report = stated ?? this.storedReport(stored);
    if (!report) throw new ReportIncompleteError();
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
      throw new GraphAlertIncompleteError({
        field: "action",
        reason:
          "An alert notifies when a metric crosses a threshold, so it " +
          "delivers by email, to Slack or to an endpoint.",
      });
    }
    if (!graphAlert) {
      throw new GraphAlertIncompleteError({
        field: "graphAlert",
        reason:
          "State the series, the operator, the threshold and the time " +
          "window this alert fires on.",
      });
    }
    if (!alertType) {
      throw new GraphAlertIncompleteError({
        field: "alertType",
        reason: "State the severity this alert fires at.",
      });
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
      // The translator's account can name internal columns, so it goes to
      // the log; the caller gets the fixed customer-safe refusal.
      logger.warn(
        { projectId, error },
        "trace query refused by the filter translator",
      );
      throw new TriggerFilterQueryInvalidError();
    }
    return query;
  }

  /**
   * Hold a delivery configuration to the field names its channel publishes.
   *
   * The channel is known before the payload is read — named on a create, taken
   * from the stored row on an update — so the shape is never inferred from
   * what the payload happens to look like. That matters twice over: several
   * channels are satisfiable by another one's payload, and a field the channel
   * does not have has no safe reading. Dropping it saves an automation that
   * delivers nowhere; keeping it parks another channel's key in the row, where
   * a later conversion could adopt it as live configuration.
   *
   * The rule an automation fires by is refused here too rather than merged: it
   * is stated in `graphAlert` or `report`, and inside `actionParams` it was
   * overwritten by the stored rule on the way to storage — a save that
   * answered 200 and changed nothing.
   */
  private assertActionParamsFieldsAreThisChannels({
    action,
    actionParams,
    kind,
  }: {
    action: TriggerAction;
    actionParams: Record<string, unknown>;
    /** What the automation is, which decides where its rule is stated. */
    kind: TriggerKind;
  }): void {
    const accepted = deliveryFieldNames(actionParamsSchemaFor(action));
    const unknown = Object.keys(actionParams).filter(
      (field) => !accepted.has(field),
    );
    if (unknown.length === 0) return;

    const ruleField =
      kind === TriggerKind.ALERT
        ? "graphAlert"
        : kind === TriggerKind.REPORT
          ? "report"
          : null;
    if (ruleField) {
      const misplaced = unknown.filter((field) =>
        RULE_FIELD_NAMES[ruleField].has(field),
      );
      if (misplaced.length > 0) {
        throw new TriggerRuleFieldsMisplacedError({
          fields: misplaced,
          expectedField: ruleField,
        });
      }
    }
    throw new TriggerActionParamsUnknownFieldsError({
      fields: unknown,
      accepted: [...accepted].sort(),
    });
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

  /**
   * How often a project may make LangWatch send on its say-so.
   *
   * The same window the dashboard's test fire uses, keyed on the project
   * rather than on a person, because a project API key is the identity behind
   * the call. Email shares the mail provider with every customer and a webhook
   * fires at an arbitrary destination from our workers, so both are capped;
   * Slack is exempt, as it did on the dashboard, because its destination is
   * pinned to Slack's own hosts.
   */
  private async assertTestFireAllowed({
    action,
    projectId,
  }: {
    action: TriggerAction;
    projectId: string;
  }): Promise<void> {
    if (
      action !== TriggerAction.SEND_EMAIL &&
      action !== TriggerAction.SEND_WEBHOOK
    ) {
      return;
    }
    const limit = await rateLimit({
      key: `testfire:project:${projectId}`,
      windowSeconds: TEST_FIRE_WINDOW_SECONDS,
      max: TEST_FIRE_MAX_PER_WINDOW,
    });
    if (!limit.allowed)
      throw new TriggerTestFireRateLimitedError(limit.resetAt);
  }
}

/** A trace automation must keep a condition after the save: create's rule,
 *  applied to what an update leaves behind. */
function assertTraceAutomationHasCondition({
  stored,
  query,
  filters,
}: {
  stored: Trigger;
  query: string | null;
  filters: Record<string, unknown>;
}): void {
  if (stored.triggerKind !== TriggerKind.AUTOMATION) return;
  if ((query ?? "").trim() !== "") return;
  if (!hasActionableTriggerFilters(filters)) {
    throw new TriggerFiltersRequiredError();
  }
}

/** The structured conditions on a stored row, which older rows hold as an
 *  object rather than the JSON string written today. Unreadable reads as none. */
function storedFilters(stored: Trigger): Record<string, unknown> {
  let value: unknown = stored.filters;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return {};
    }
  }
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {};
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
  /** Accepted for the same reason as `action`: a different graph is refused. */
  customGraphId?: string | null;
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

/** The actor for an API write with no user behind its key (governance precedent). */
function apiActorFallback(projectId: string): string {
  return `svc_${projectId}`;
}

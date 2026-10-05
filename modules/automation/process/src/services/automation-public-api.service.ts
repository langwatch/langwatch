/**
 * What the public API may write, and on what terms: the same row the dashboard
 * writes, held to the same rules. The channel and the kind are fixed once an
 * automation exists. Main's `PublicApiTriggerService` (#6900); pure parts in `rules/`.
 */
import {
  buildGraphAlertTriggerData,
  buildReportTriggerData,
  DEFAULT_TRACE_DEBOUNCE_MS,
  findGraphAlertFromTriggerRow,
  findReportFromTriggerRow,
  graphAlertActionParamsSchema,
  GraphAlertIncompleteError,
  GraphNotFoundError,
  hasActionableTriggerFilters,
  NOTIFY_TRIGGER_ACTIONS,
  ReportChannelUnsupportedError,
  ReportIncompleteError,
  TestFireUnavailableError,
  TriggerAction,
  TriggerActionImmutableError,
  TriggerFilterQueryInvalidError,
  TriggerFiltersRequiredError,
  TriggerFiltersUnsupportedError,
  TriggerGraphImmutableError,
  TriggerKindImmutableError,
  TriggerNotFoundError,
  TriggerTestFireRateLimitedError,
  type AutomationApiFireHistoryInput,
  type AutomationRestCreateInput,
  type AutomationRestUpdateInput,
  type CreateTriggerCommand,
  type GraphAlertActionParams,
  type ReportActionParams,
  type TestFireInput,
  type TestFireResult,
  type Trigger,
  type TriggerAction as TriggerActionValue,
  type TriggerFirePage,
  type TriggerKind,
  type UpdateTriggerCommand,
} from "@langwatch/automation-contract";
import { generate as ksuid } from "@langwatch/ksuid";
import { nowInstant, toDate } from "@langwatch/time";
import { z } from "zod";

import type {
  AutomationCallCounter,
  AutomationProviderSecrets,
  AutomationTraceFilterCompiler,
  AutomationWebhookStoredParams,
} from "../app/automation.app.ts";
import type { TriggerFireHistoryRepository } from "../repositories/trigger-fire-history.repository.ts";
import {
  partitionFilterFields,
  resolveCadenceForCreate,
  resolveCadenceForUpdate,
} from "../rules/automation-authoring.rules.ts";
import {
  assertActionParamsFieldsAreThisChannels,
  assertHeaderValuesTravelWithTheirDestination,
  channelActionParamsSchema,
  readDeliveryConfiguration,
  resolveCredentialPlaceholders,
  splitStoredRuleFromDelivery,
} from "../rules/trigger-redaction.rules.ts";
import type { AutomationRulesService } from "./automation-rules.service.ts";
import type { AutomationSlackConnectionService } from "./automation-slack-connection.service.ts";
import type { AutomationLogger, AutomationService } from "./automation.service.ts";
import type { SlackDestinationService } from "./slack-destination.service.ts";
import type { TriggerFilterValidationService } from "./trigger-filter-validation.service.ts";

/** The dashboard's test-fire window, keyed on the project an API key acts for. */
const TEST_FIRE_WINDOW_SECONDS = 60;
const TEST_FIRE_MAX_PER_WINDOW = 10;

const recordSchema = z.record(z.string(), z.unknown());
const memberAddressesSchema = z.array(z.string()).catch([]);

type RowColumns = Omit<CreateTriggerCommand, "id" | "projectId">;

/** The rows and side effects a public-API write goes through. */
export type AutomationPublicApiRows = Pick<
  AutomationService,
  | "findById"
  | "softDeleteById"
  | "create"
  | "update"
  | "invalidate"
  | "syncReportSchedule"
  | "removeReportSchedule"
  | "validateTemplateDraft"
  | "testFire"
  | "customGraphExistsInProject"
>;

export interface AutomationPublicApiCollaborators {
  automation: AutomationPublicApiRows;
  rules: Pick<AutomationRulesService, "getProjectIdentity">;
  providers: AutomationProviderSecrets;
  slackConnections: Pick<
    AutomationSlackConnectionService,
    "connectActionParams" | "withKeptLegacySlackSecret"
  >;
  slackDestinations: Pick<SlackDestinationService, "findSlackDestination">;
  filterValidation: Pick<TriggerFilterValidationService, "assertWritable">;
  history: Pick<TriggerFireHistoryRepository, "listPageByTriggerId">;
  traceFilters: AutomationTraceFilterCompiler;
  limits: AutomationCallCounter;
  logger: AutomationLogger;
}

export class AutomationPublicApiService {
  static create(collaborators: AutomationPublicApiCollaborators): AutomationPublicApiService {
    return new AutomationPublicApiService(collaborators);
  }

  private constructor(private readonly deps: AutomationPublicApiCollaborators) {}

  /** One live automation of the project, or `trigger_not_found`. */
  async getById({
    projectId,
    triggerId,
  }: {
    projectId: string;
    triggerId: string;
  }): Promise<Trigger> {
    const trigger = await this.deps.automation.findById({ projectId, triggerId });
    if (!trigger || trigger.deleted) throw new TriggerNotFoundError();
    return trigger;
  }

  /** One live automation of the project as the API reads it, credentials redacted. */
  async getRedactedById(input: { projectId: string; triggerId: string }): Promise<Trigger> {
    return this.redactForRead(await this.getById(input));
  }

  /** Soft-deletes one live automation and retires its report schedule, or `trigger_not_found`. */
  async deleteById({
    projectId,
    triggerId,
  }: {
    projectId: string;
    triggerId: string;
  }): Promise<void> {
    await this.getById({ projectId, triggerId });
    await this.deps.automation.softDeleteById({ projectId, triggerId });
    await this.deps.automation.removeReportSchedule({ projectId, triggerId });
  }

  async create({
    projectId,
    input,
    actorId,
  }: {
    projectId: string;
    input: AutomationRestCreateInput;
    /** Who a Slack connection made from a legacy secret is attributed to. */
    actorId: string;
  }): Promise<Trigger> {
    if (input.templates) this.deps.automation.validateTemplateDraft(input.templates);

    const isGraphAlert = !!input.customGraphId;
    const id = ksuid("trigger").toString();
    const columns = await this.createColumns({ id, projectId, input, actorId });
    const trigger = await this.deps.automation.create({
      ...columns,
      id,
      projectId,
      actorId,
      message: input.message ?? null,
      notificationCadence: resolveCadenceForCreate(
        input.action,
        input.notificationCadence,
        isGraphAlert,
      ),
      traceDebounceMs: input.traceDebounceMs ?? DEFAULT_TRACE_DEBOUNCE_MS,
      lastRunAt: toDate(nowInstant()),
    });

    if (!isGraphAlert && input.report) {
      await this.deps.automation.syncReportSchedule({
        projectId,
        triggerId: trigger.id,
        cron: input.report.schedule.cron,
        timezone: input.report.schedule.timezone,
      });
    }
    await this.deps.automation.invalidate(projectId);
    return this.redactForRead(trigger);
  }

  async update({
    projectId,
    triggerId,
    input,
    actorId,
  }: {
    projectId: string;
    triggerId: string;
    input: AutomationRestUpdateInput;
    actorId: string;
  }): Promise<Trigger> {
    const stored = await this.getById({ projectId, triggerId });
    assertWhatIsFixedIsUnchanged({ stored, input });
    if (input.templates) this.deps.automation.validateTemplateDraft(input.templates);

    const command: UpdateTriggerCommand = {
      id: triggerId,
      projectId,
      ...templateColumns(input.templates),
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
      // Resuming clears the pause record, the same as enable does.
      ...(input.active === true ? { pausedReason: null, pausedAt: null } : {}),
      ...(input.message !== undefined ? { message: input.message } : {}),
      ...(input.alertType !== undefined ? { alertType: input.alertType } : {}),
      ...(input.traceDebounceMs !== undefined ? { traceDebounceMs: input.traceDebounceMs } : {}),
      ...(await this.conditionUpdate({ projectId, stored, input })),
      ...(await this.actionParamsUpdate({ projectId, stored, input, actorId })),
    };
    // A pinned cadence is stated on every save, so the stored value cannot outlive what reads it.
    const cadence = resolveCadenceForUpdate(
      stored.action,
      input.notificationCadence,
      stored.customGraphId !== null,
    );
    if (cadence !== "unchanged") command.notificationCadence = cadence.cadence;

    const updated = await this.deps.automation.update(command);
    if (stored.triggerKind === "REPORT")
      await this.syncReportSchedule({ projectId, trigger: updated });
    await this.deps.automation.invalidate(projectId);
    return this.redactForRead(updated);
  }

  /**
   * Resume or pause. A report's schedule does not live on the row: pausing
   * retires its calendar entry, resuming puts it back (or retires it when the
   * report no longer parses), and resuming clears the pause record.
   */
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
    const updated = await this.deps.automation.update({
      id: triggerId,
      projectId,
      active,
      ...(active ? { pausedReason: null, pausedAt: null } : {}),
    });
    if (stored.triggerKind === "REPORT") {
      if (active) await this.syncReportSchedule({ projectId, trigger: updated });
      else await this.deps.automation.removeReportSchedule({ projectId, triggerId });
    }
    await this.deps.automation.invalidate(projectId);
    return this.redactForRead(updated);
  }

  /** One page of this automation's fires, newest first. Metadata only. */
  async getFireHistory(input: AutomationApiFireHistoryInput): Promise<TriggerFirePage> {
    await this.getById(input);
    return this.deps.history.listPageByTriggerId(input);
  }

  /**
   * Send this automation's message to its saved destination, never one the
   * request supplies. The per-project cap bounds how often a key can make
   * LangWatch send (ADR-040 §4); nothing is recorded as a fire.
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
    const project = await this.deps.rules.getProjectIdentity(projectId);
    const graphAlert = findGraphAlertFromTriggerRow(trigger.actionParams);
    const report = findReportFromTriggerRow(trigger.actionParams);

    return this.deps.automation.testFire({
      trigger: { name: trigger.name, alertType: trigger.alertType },
      project,
      draft: trigger.templates,
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

  /** The provider's own redaction; a row whose secrets cannot be read lists with none. */
  redactForRead(trigger: Trigger): Trigger {
    try {
      const params = this.deps.providers.redactActionParamsFor(
        trigger.action,
        trigger.actionParams,
      );
      return { ...trigger, actionParams: recordSchema.catch({}).parse(params) };
    } catch (error) {
      this.deps.logger.warn(
        { error: error instanceof Error ? error.message : String(error), action: trigger.action },
        "trigger delivery configuration could not be read; returning it empty",
      );
      return { ...trigger, actionParams: {} };
    }
  }

  /** The row a create writes, shaped by what the automation is about. */
  private async createColumns({
    id,
    projectId,
    input,
    actorId,
  }: {
    id: string;
    projectId: string;
    input: AutomationRestCreateInput;
    actorId: string;
  }): Promise<RowColumns> {
    const filterQuery = this.readFilterQuery({ filterQuery: input.filterQuery, projectId });
    const filters = sanitizeFilters(input.filters ?? {});
    const kind = createdKind(input);
    assertActionParamsFieldsAreThisChannels({
      action: input.action,
      actionParams: input.actionParams,
      kind,
    });
    // Every refusal precedes the delivery persisting: a legacy Slack secret becomes a connection.
    const delivery = () =>
      this.persistedDelivery({
        action: input.action,
        incoming: input.actionParams,
        projectId,
        actorId,
        stored: undefined,
      });
    const templates = templateColumns(input.templates);

    if (input.customGraphId) {
      const rule = await this.readGraphAlert({
        projectId,
        input,
        customGraphId: input.customGraphId,
      });
      const built = buildGraphAlertTriggerData({
        id,
        name: input.name,
        projectId,
        action: rule.action,
        alertType: rule.alertType,
        customGraphId: input.customGraphId,
        actionParams: { ...(await delivery()), ...rule.graphAlert },
      });
      return {
        name: built.name,
        action: built.action,
        triggerKind: "ALERT",
        alertType: built.alertType,
        filters: recordSchema.parse(built.filters),
        filterQuery: null,
        customGraphId: built.customGraphId,
        actionParams: recordSchema.parse(built.actionParams),
        ...templates,
      };
    }
    if (input.report) {
      const action = readReportAction({ action: input.action });
      const built = buildReportTriggerData({
        id,
        name: input.name,
        projectId,
        action,
        actionParams: { ...(await delivery()), ...input.report },
      });
      return {
        name: built.name,
        action: built.action,
        triggerKind: "REPORT",
        filters: recordSchema.parse(built.filters),
        customGraphId: null,
        // A trace-query report sends what its query selects; a graph or dashboard report has none.
        filterQuery: input.report.source.kind === "traceQuery" ? filterQuery : null,
        actionParams: recordSchema.parse(built.actionParams),
        ...templates,
      };
    }

    // A trace automation says which traces it is about; a query supersedes the structured set.
    if (filterQuery === null) {
      if (!hasActionableTriggerFilters(filters)) throw new TriggerFiltersRequiredError();
      await this.deps.filterValidation.assertWritable({ projectId, filters });
    }
    return {
      name: input.name,
      action: input.action,
      triggerKind: "AUTOMATION",
      alertType: input.alertType ?? null,
      filters: filterQuery !== null ? {} : filters,
      filterQuery,
      actionParams: await delivery(),
      ...templates,
    };
  }

  /**
   * What the automation is about, as far as this save states it: judged on the
   * condition it leaves behind, so clearing a query-only automation's query is
   * refused as a create with no condition is. Alerts and reports have none.
   */
  private async conditionUpdate({
    projectId,
    stored,
    input,
  }: {
    projectId: string;
    stored: Trigger;
    input: AutomationRestUpdateInput;
  }): Promise<Pick<UpdateTriggerCommand, "filters" | "filterQuery">> {
    if (input.filterQuery === undefined && input.filters === undefined) return {};
    const query =
      input.filterQuery !== undefined
        ? this.readFilterQuery({ filterQuery: input.filterQuery, projectId })
        : stored.filterQuery;
    const filters = input.filters !== undefined ? sanitizeFilters(input.filters) : stored.filters;
    const keepsACondition = (query ?? "").trim() !== "" || hasActionableTriggerFilters(filters);
    if (stored.triggerKind === "AUTOMATION" && !keepsACondition)
      throw new TriggerFiltersRequiredError();
    if (input.filters !== undefined)
      await this.deps.filterValidation.assertWritable({ projectId, filters });
    return {
      ...(input.filterQuery !== undefined ? { filterQuery: query } : {}),
      ...(input.filters !== undefined ? { filters } : {}),
    };
  }

  /**
   * Delivery and rule share one column, so a save touching either states both
   * and the stored row supplies the half this call did not. Only the rule
   * changing leaves the delivery half exactly as stored, never re-persisted.
   */
  private async actionParamsUpdate({
    projectId,
    stored,
    input,
    actorId,
  }: {
    projectId: string;
    stored: Trigger;
    input: AutomationRestUpdateInput;
    actorId: string;
  }): Promise<Pick<UpdateTriggerCommand, "actionParams">> {
    const statedRule = this.statedRule({ stored, input });
    const rule =
      statedRule === undefined && input.actionParams === undefined
        ? undefined
        : { ...storedRule(stored), ...statedRule };

    if (input.actionParams !== undefined) {
      const kind: TriggerKind = stored.customGraphId !== null ? "ALERT" : stored.triggerKind;
      assertActionParamsFieldsAreThisChannels({
        action: stored.action,
        actionParams: input.actionParams,
        kind,
      });
      const delivery = await this.persistedDelivery({
        action: stored.action,
        incoming: input.actionParams,
        projectId,
        actorId,
        stored: stored.actionParams,
      });
      return { actionParams: { ...rule, ...delivery } };
    }
    if (rule === undefined) return {};
    return { actionParams: { ...stored.actionParams, ...rule } };
  }

  /** The rule half an update states: the incoming one, else the stored. None for a trace one. */
  private statedRule({
    stored,
    input,
  }: {
    stored: Trigger;
    input: AutomationRestUpdateInput;
  }): Record<string, unknown> | undefined {
    const isAlert = stored.customGraphId !== null;
    if (!isAlert && stored.triggerKind !== "REPORT") return undefined;
    const stated = isAlert ? input.graphAlert : input.report;
    if (stated === undefined && input.actionParams === undefined) return undefined;
    if (isAlert) {
      const rule = input.graphAlert ?? findGraphAlertRule(stored);
      if (!rule) {
        throw new GraphAlertIncompleteError({
          field: "graphAlert",
          reason:
            "This alert has no rule to fire by. State the series, the operator, the threshold and the time window.",
        });
      }
      return { ...rule };
    }
    const report = input.report ?? findReportRule(stored);
    if (!report) throw new ReportIncompleteError();
    readReportAction({ action: stored.action });
    return { ...report };
  }

  /**
   * A save's delivery in its at-rest form: Slack pointed at a connection (a
   * kept legacy secret moved into one on an update, ADR-093 §5a), each
   * placeholder resolved to the kept sentinel, then the channel's persist hook.
   */
  private async persistedDelivery({
    action,
    incoming,
    projectId,
    actorId,
    stored,
  }: {
    action: TriggerActionValue;
    incoming: Record<string, unknown>;
    projectId: string;
    actorId: string;
    stored: Record<string, unknown> | undefined;
  }): Promise<Record<string, unknown>> {
    const connected =
      action === TriggerAction.SEND_SLACK_MESSAGE
        ? await this.deps.slackConnections.connectActionParams({
            projectId,
            actorId,
            actionParams:
              stored === undefined
                ? incoming
                : this.deps.slackConnections.withKeptLegacySlackSecret({
                    actionParams: incoming,
                    stored,
                  }),
          })
        : incoming;
    assertHeaderValuesTravelWithTheirDestination({ action, incoming: connected, stored });
    const { delivery } = splitStoredRuleFromDelivery(
      resolveCredentialPlaceholders({ action, incoming: connected }),
    );
    const persisted = await this.deps.providers.persistActionParamsFor(action, {
      incoming: readDeliveryConfiguration({ schema: channelActionParamsSchema(action), delivery }),
      loadExisting: () => Promise.resolve(stored),
    });
    return recordSchema.catch({}).parse(persisted);
  }

  /** A graph alert notifies, has a rule and a severity, and fires on a graph of this project. */
  private async readGraphAlert({
    projectId,
    input,
    customGraphId,
  }: {
    projectId: string;
    input: AutomationRestCreateInput;
    customGraphId: string;
  }): Promise<{
    action: "SEND_EMAIL" | "SEND_SLACK_MESSAGE" | "SEND_WEBHOOK";
    alertType: "CRITICAL" | "WARNING" | "INFO";
    graphAlert: GraphAlertActionParams;
  }> {
    const action = getNotifyingAction(input.action);
    if (!input.graphAlert) {
      throw new GraphAlertIncompleteError({
        field: "graphAlert",
        reason:
          "State the series, the operator, the threshold and the time window this alert fires on.",
      });
    }
    if (!input.alertType) {
      throw new GraphAlertIncompleteError({
        field: "alertType",
        reason: "State the severity this alert fires at.",
      });
    }
    const exists = await this.deps.automation.customGraphExistsInProject({
      customGraphId,
      projectId,
    });
    if (!exists) throw new GraphNotFoundError();
    return { action, alertType: input.alertType, graphAlert: input.graphAlert };
  }

  /**
   * The trace query, trimmed and dry-run through the compiler, so an unreadable
   * one is refused at the save rather than matching nothing at dispatch. The
   * compiler's account can name internal columns, so it goes to the log.
   */
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
      this.deps.traceFilters.assertCompiles({ query, projectId });
    } catch (error) {
      this.deps.logger.warn(
        { projectId, error: error instanceof Error ? error.message : String(error) },
        "trace query refused by the filter translator",
      );
      throw new TriggerFilterQueryInvalidError();
    }
    return query;
  }

  private async syncReportSchedule({
    projectId,
    trigger,
  }: {
    projectId: string;
    trigger: Trigger;
  }): Promise<void> {
    const report = findReportFromTriggerRow(trigger.actionParams);
    if (!report || !trigger.active) {
      await this.deps.automation.removeReportSchedule({ projectId, triggerId: trigger.id });
      return;
    }
    await this.deps.automation.syncReportSchedule({
      projectId,
      triggerId: trigger.id,
      cron: report.schedule.cron,
      timezone: report.schedule.timezone,
    });
  }

  /** Email and webhook share a provider or hit any host, so both are capped; Slack is pinned. */
  private async assertTestFireAllowed({
    action,
    projectId,
  }: {
    action: TriggerActionValue;
    projectId: string;
  }): Promise<void> {
    if (action !== TriggerAction.SEND_EMAIL && action !== TriggerAction.SEND_WEBHOOK) return;
    const limit = await this.deps.limits.count({
      key: `testfire:project:${projectId}`,
      windowSeconds: TEST_FIRE_WINDOW_SECONDS,
      max: TEST_FIRE_MAX_PER_WINDOW,
    });
    if (!limit.allowed) throw new TriggerTestFireRateLimitedError(limit.resetAt);
  }

  /** Where the test fire goes: the saved row's destination, read as a real delivery reads it. */
  private async savedDestination(
    trigger: Trigger,
  ): Promise<
    Pick<
      TestFireInput,
      "channel" | "recipients" | "webhook" | "botDestination" | "webhookDestination"
    >
  > {
    const params = trigger.actionParams;
    switch (trigger.action) {
      case TriggerAction.SEND_EMAIL: {
        const recipients = memberAddressesSchema.parse(params.members);
        if (recipients.length === 0) {
          throw new TestFireUnavailableError(
            "email",
            "This automation has no email recipients to test-fire to.",
          );
        }
        return { channel: "email", recipients, webhook: null };
      }
      case TriggerAction.SEND_SLACK_MESSAGE:
        return this.savedSlackDestination({ params, projectId: trigger.projectId });
      case TriggerAction.SEND_WEBHOOK:
        return this.savedWebhookDestination(params);
      default:
        // Dataset rows and queue items are written, not delivered: nothing a test fire could prove.
        throw new TestFireUnavailableError(
          "email",
          "This automation writes a record rather than sending a message, so there is nothing to test-fire.",
        );
    }
  }

  private async savedSlackDestination({
    params,
    projectId,
  }: {
    params: Record<string, unknown>;
    projectId: string;
  }): Promise<Pick<TestFireInput, "channel" | "recipients" | "webhook" | "botDestination">> {
    const [destination] = await this.deps.slackDestinations.findSlackDestination({
      projectId,
      actionParams: params,
    });
    if (!destination) {
      throw new TestFireUnavailableError(
        "slack",
        "This automation has no Slack connection to test-fire to.",
      );
    }
    if (destination.kind === "webhook")
      return { channel: "slack", recipients: [], webhook: destination.url };
    if (!destination.channel) {
      // Fail closed: a bot connection without a channel has nowhere to post.
      throw new TestFireUnavailableError(
        "slack",
        "This automation delivers through a Slack connection, and no channel resolves for it.",
      );
    }
    return {
      channel: "slack",
      recipients: [],
      webhook: null,
      botDestination: { token: destination.token, channel: destination.channel },
    };
  }

  /** The full request a real delivery would make, signed the same way. */
  private savedWebhookDestination(
    params: Record<string, unknown>,
  ): Pick<TestFireInput, "channel" | "recipients" | "webhook" | "webhookDestination"> {
    const stored = storedWebhookSchema.safeParse(params);
    if (!stored.success) {
      throw new TestFireUnavailableError(
        "webhook",
        "This automation has no destination to test-fire to.",
      );
    }
    const webhookParams: AutomationWebhookStoredParams = {
      ...stored.data,
      method: stored.data.method ?? "POST",
    };
    return {
      channel: "webhook",
      recipients: [],
      webhook: null,
      webhookDestination: {
        url: stored.data.url,
        method: stored.data.method ?? "POST",
        headers: this.deps.providers.decryptWebhookHeaders(webhookParams),
        bodyTemplate: stored.data.bodyTemplate ?? null,
        signingSecrets: this.deps.providers.decryptWebhookSigningSecrets(webhookParams),
      },
    };
  }
}

/** The at-rest webhook fields a test fire reads; a row with no url has nowhere to go. */
const storedWebhookSchema = z
  .object({
    url: z.string().min(1),
    method: z.enum(["POST", "PUT", "PATCH"]).optional(),
    bodyTemplate: z
      .string()
      .nullable()
      .optional()
      .transform((value) => value ?? null),
    contentType: z.string().optional(),
    headersEncrypted: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    signingSecretEncrypted: z.string().optional(),
    previousSigningSecretEncrypted: z.string().optional(),
    previousSigningSecretExpiresAt: z.number().optional(),
  })
  .loose();

/** The channel, the kind and an alert's graph are fixed once an automation exists. */
function assertWhatIsFixedIsUnchanged({
  stored,
  input,
}: {
  stored: Trigger;
  input: AutomationRestUpdateInput;
}): void {
  if (input.action !== undefined && input.action !== stored.action) {
    throw new TriggerActionImmutableError(stored.action);
  }
  const kind = stored.triggerKind.toLowerCase();
  assertGraphIsUnchanged({ stored, stated: input.customGraphId, kind });
  if (input.graphAlert !== undefined && stored.customGraphId === null)
    throw new TriggerKindImmutableError(kind);
  if (input.report !== undefined && stored.triggerKind !== "REPORT")
    throw new TriggerKindImmutableError(kind);
}

/** A stated graph must be the stored one: adding or removing a graph changes the kind. */
function assertGraphIsUnchanged({
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

/** Conditions on fields this platform no longer filters on are dropped; only those alone refuse. */
function sanitizeFilters(filters: Record<string, unknown>): Record<string, unknown> {
  const { sanitized, unknownFields } = partitionFilterFields(filters);
  if (unknownFields.length > 0 && Object.keys(sanitized).length === 0) {
    throw new TriggerFiltersUnsupportedError(unknownFields);
  }
  return sanitized;
}

/** A report renders a message on a schedule, so it delivers on a channel that carries one. */
function readReportAction({
  action,
}: {
  action: TriggerActionValue;
}): "SEND_EMAIL" | "SEND_SLACK_MESSAGE" {
  if (action === TriggerAction.SEND_EMAIL || action === TriggerAction.SEND_SLACK_MESSAGE)
    return action;
  throw new ReportChannelUnsupportedError();
}

function createdKind(input: AutomationRestCreateInput): TriggerKind {
  if (input.customGraphId) return "ALERT";
  return input.report ? "REPORT" : "AUTOMATION";
}

/** An alert notifies, so it delivers by email, to Slack or to an endpoint. */
function getNotifyingAction(
  action: TriggerActionValue,
): "SEND_EMAIL" | "SEND_SLACK_MESSAGE" | "SEND_WEBHOOK" {
  if (
    NOTIFY_TRIGGER_ACTIONS.has(action) &&
    (action === TriggerAction.SEND_EMAIL ||
      action === TriggerAction.SEND_SLACK_MESSAGE ||
      action === TriggerAction.SEND_WEBHOOK)
  ) {
    return action;
  }
  throw new GraphAlertIncompleteError({
    field: "action",
    reason:
      "An alert notifies when a metric crosses a threshold, so it delivers by email, to Slack or to an endpoint.",
  });
}

/** The rule half of a stored row, whichever kind it is; a trace automation has none. */
function storedRule(stored: Trigger): Record<string, unknown> {
  return { ...(findGraphAlertRule(stored) ?? findReportRule(stored)) };
}

function findGraphAlertRule(stored: Trigger): GraphAlertActionParams | undefined {
  const parsed = graphAlertActionParamsSchema.safeParse(stored.actionParams);
  return parsed.success ? parsed.data : undefined;
}

function findReportRule(stored: Trigger): ReportActionParams | undefined {
  const parsed = findReportFromTriggerRow(stored.actionParams);
  if (!parsed) return undefined;
  return {
    source: parsed.source,
    schedule: parsed.schedule,
    compareToPrevious: parsed.compareToPrevious,
  };
}

/** The four Liquid template columns, stated only when the caller stated them. */
function templateColumns(
  templates: AutomationRestUpdateInput["templates"],
): Partial<UpdateTriggerCommand> {
  if (!templates) return {};
  return {
    slackTemplateType: templates.slackTemplateType ?? null,
    slackTemplate: templates.slackTemplate ?? null,
    emailSubjectTemplate: templates.emailSubjectTemplate ?? null,
    emailBodyTemplate: templates.emailBodyTemplate ?? null,
  };
}

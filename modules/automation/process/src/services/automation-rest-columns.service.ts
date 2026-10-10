/** The columns a public-API create or update writes, each refused before any secret persists. */
import {
  buildGraphAlertTriggerData,
  buildReportTriggerData,
  GraphAlertIncompleteError,
  GraphNotFoundError,
  hasActionableTriggerFilters,
  ReportIncompleteError,
  TriggerAction,
  TriggerFilterQueryInvalidError,
  TriggerFiltersRequiredError,
  type AutomationRestCreateInput,
  type AutomationRestUpdateInput,
  type CreateTriggerCommand,
  type GraphAlertActionParams,
  type Trigger,
  type TriggerAction as TriggerActionValue,
  type TriggerKind,
  type UpdateTriggerCommand,
} from "@langwatch/automation-contract";
import { z } from "zod";

import type {
  AutomationProviderSecrets,
  AutomationTraceFilterCompiler,
} from "../app/automation.app.ts";
import type { AutomationSlackConnectionService } from "../features/slack/services/automation-slack-connection.service.ts";
import {
  createdKind,
  findGraphAlertRule,
  findReportRule,
  getNotifyingAction,
  readReportAction,
  sanitizeFilters,
  storedRule,
  templateColumns,
} from "../rules/automation-public-api.rules.ts";
import {
  assertActionParamsFieldsAreThisChannels,
  assertHeaderValuesTravelWithTheirDestination,
  readDeliveryConfiguration,
  resolveCredentialPlaceholders,
  splitStoredRuleFromDelivery,
} from "../rules/trigger-redaction.rules.ts";
import type { AutomationLogger, AutomationService } from "./automation.service.ts";
import type { TriggerFilterValidationService } from "./trigger-filter-validation.service.ts";

const recordSchema = z.record(z.string(), z.unknown());

type RowColumns = Omit<CreateTriggerCommand, "id" | "projectId">;

interface AutomationRestColumnsCollaborators {
  automation: Pick<AutomationService, "customGraphExistsInProject">;
  providers: AutomationProviderSecrets;
  slackConnections: Pick<
    AutomationSlackConnectionService,
    "connectActionParams" | "withKeptLegacySlackSecret"
  >;
  filterValidation: Pick<TriggerFilterValidationService, "assertWritable">;
  traceFilters: AutomationTraceFilterCompiler;
  logger: AutomationLogger;
}

export class AutomationRestColumnsService {
  static create(collaborators: AutomationRestColumnsCollaborators): AutomationRestColumnsService {
    return new AutomationRestColumnsService(collaborators);
  }

  private constructor(private readonly deps: AutomationRestColumnsCollaborators) {}

  /** The row a create writes, shaped by what the automation is about. */
  async createColumns({
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
      return this.graphAlertColumns({
        id,
        projectId,
        input,
        customGraphId: input.customGraphId,
        delivery,
        templates,
      });
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

  /** An alert's columns: its rule is refused before its delivery persists. */
  private async graphAlertColumns({
    id,
    projectId,
    input,
    customGraphId,
    delivery,
    templates,
  }: {
    id: string;
    projectId: string;
    input: AutomationRestCreateInput;
    customGraphId: string;
    delivery: () => Promise<Record<string, unknown>>;
    templates: Partial<UpdateTriggerCommand>;
  }): Promise<RowColumns> {
    const rule = await this.readGraphAlert({
      projectId,
      input,
      customGraphId,
    });
    const built = buildGraphAlertTriggerData({
      id,
      name: input.name,
      projectId,
      action: rule.action,
      alertType: rule.alertType,
      customGraphId,
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

  /**
   * What the automation is about, as far as this save states it: judged on the
   * condition it leaves behind, so clearing a query-only automation's query is
   * refused as a create with no condition is. Alerts and reports have none.
   */
  async conditionUpdate({
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
  async actionParamsUpdate({
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
      incoming: readDeliveryConfiguration({
        schema: this.deps.providers.actionParamsSchemaFor(action),
        delivery,
      }),
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
}

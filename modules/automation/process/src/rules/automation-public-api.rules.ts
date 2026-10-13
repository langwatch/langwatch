/** Public-API write terms that need only their arguments (main's `PublicApiTriggerService`). */
import {
  findReportFromTriggerRow,
  graphAlertActionParamsSchema,
  GraphAlertIncompleteError,
  NOTIFY_TRIGGER_ACTIONS,
  ReportChannelUnsupportedError,
  TriggerAction,
  TriggerActionImmutableError,
  TriggerFiltersUnsupportedError,
  TriggerGraphImmutableError,
  TriggerKindImmutableError,
  type AutomationRestCreateInput,
  type AutomationRestUpdateInput,
  type GraphAlertActionParams,
  type ReportActionParams,
  type Trigger,
  type TriggerAction as TriggerActionValue,
  type TriggerKind,
  type UpdateTriggerCommand,
} from "@langwatch/automation-contract";

import { partitionFilterFields } from "./automation-authoring.rules.ts";

/** The channel, the kind and an alert's graph are fixed once an automation exists. */
export function assertWhatIsFixedIsUnchanged({
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
export function sanitizeFilters(filters: Record<string, unknown>): Record<string, unknown> {
  const { sanitized, unknownFields } = partitionFilterFields(filters);
  if (unknownFields.length > 0 && Object.keys(sanitized).length === 0) {
    throw new TriggerFiltersUnsupportedError(unknownFields);
  }
  return sanitized;
}

/** A report renders a message on a schedule, so it delivers on a channel that carries one. */
export function readReportAction({
  action,
}: {
  action: TriggerActionValue;
}): "SEND_EMAIL" | "SEND_SLACK_MESSAGE" {
  if (action === TriggerAction.SEND_EMAIL || action === TriggerAction.SEND_SLACK_MESSAGE)
    return action;
  throw new ReportChannelUnsupportedError();
}

export function createdKind(input: AutomationRestCreateInput): TriggerKind {
  if (input.customGraphId) return "ALERT";
  return input.report ? "REPORT" : "AUTOMATION";
}

/** An alert notifies, so it delivers by email, to Slack or to an endpoint. */
export function getNotifyingAction(
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
export function storedRule(stored: Trigger): Record<string, unknown> {
  return { ...(findGraphAlertRule(stored) ?? findReportRule(stored)) };
}

export function findGraphAlertRule(stored: Trigger): GraphAlertActionParams | undefined {
  const parsed = graphAlertActionParamsSchema.safeParse(stored.actionParams);
  return parsed.success ? parsed.data : undefined;
}

export function findReportRule(stored: Trigger): ReportActionParams | undefined {
  const parsed = findReportFromTriggerRow(stored.actionParams);
  if (!parsed) return undefined;
  return {
    source: parsed.source,
    schedule: parsed.schedule,
    compareToPrevious: parsed.compareToPrevious,
  };
}

/** The four Liquid template columns, stated only when the caller stated them. */
export function templateColumns(
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

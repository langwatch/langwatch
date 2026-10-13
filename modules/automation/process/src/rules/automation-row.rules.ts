/** The row an authoring save writes, in the shape its kind is dispatched from. */
import {
  buildGraphAlertTriggerData,
  buildReportTriggerData,
  type AutomationApiUpsertInput,
  type CreateTriggerCommand,
  type GraphAlertActionParams,
} from "@langwatch/automation-contract";
import { z } from "zod";

import { notifyingActionOr } from "./automation-authoring.rules.ts";

/**
 * The app's KSUID resource for a trigger row (`KSUID_RESOURCES.TRIGGER`). The
 * literal rather than the app's constant table: the prefix is part of the id
 * format already written to the database, so it belongs with the writer.
 */
export const TRIGGER_KSUID_RESOURCE = "trigger";

/** The columns a save writes, whichever of the three kinds the automation is. */
export type AutomationRowDraft = Omit<
  CreateTriggerCommand,
  "id" | "projectId" | "lastRunAt" | "notificationCadence" | "traceDebounceMs"
>;

/** The row one save writes, in the shape its kind is dispatched from. */
export function automationRowFor(args: {
  input: AutomationApiUpsertInput;
  actionParams: Record<string, unknown>;
  filterQuery: string | null;
  isGraphAlert: boolean;
  isReport: boolean;
  /** The id the graph-alert and report builders stamp: the row's own, or a fresh one. */
  id: string;
}): AutomationRowDraft {
  const { input, actionParams, filterQuery, isGraphAlert, isReport, id } = args;
  const templates = {
    slackTemplateType: input.templates.slackTemplateType ?? null,
    slackTemplate: input.templates.slackTemplate ?? null,
    emailSubjectTemplate: input.templates.emailSubjectTemplate ?? null,
    emailBodyTemplate: input.templates.emailBodyTemplate ?? null,
  };

  if (isGraphAlert && input.graphAlert && input.customGraphId) {
    const graphAlert: GraphAlertActionParams = input.graphAlert;
    const built = buildGraphAlertTriggerData({
      id,
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
      id,
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

/** A builder's own loosely-typed record, as the row column accepts it. */
function recordOf(value: unknown): Record<string, unknown> {
  return z.record(z.string(), z.unknown()).parse(value);
}

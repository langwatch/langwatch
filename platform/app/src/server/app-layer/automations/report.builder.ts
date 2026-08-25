import {
  buildReportTriggerData as buildContractReportTriggerData,
  reportActionParamsSchema,
  reportScheduleSchema,
  reportSourceSchema,
  extractReportFromTriggerRow,
  REPORT_SCHEDULER_TARGET_TYPE,
  type ReportActionParams,
  type ReportScheduleInput,
  type ReportSource,
} from "@langwatch/automation-contract";
import type { Prisma, TriggerAction } from "~/generated/prisma/client";
import { TriggerKind } from "~/generated/prisma/client";

/**
 * App-only transport adapter for the legacy Prisma trigger writer. Report
 * validation, parsing, and the portable report row shape live in the feature
 * contract; this file only converts the generated Prisma enum/JSON types.
 */
export {
  reportActionParamsSchema,
  reportScheduleSchema,
  reportSourceSchema,
  extractReportFromTriggerRow,
  REPORT_SCHEDULER_TARGET_TYPE,
};
export type { ReportActionParams, ReportScheduleInput, ReportSource };

export interface BuildReportTriggerDataInput {
  id: string;
  name: string;
  projectId: string;
  action: TriggerAction;
  actionParams: ReportActionParams & {
    members?: string[];
    slackWebhook?: string;
  };
}

export interface ReportTriggerData {
  id: string;
  name: string;
  projectId: string;
  action: TriggerAction;
  triggerKind: TriggerKind;
  actionParams: Prisma.InputJsonValue;
  filters: Prisma.InputJsonValue;
  active: true;
}

export function buildReportTriggerData(
  input: BuildReportTriggerDataInput,
): ReportTriggerData {
  const built = buildContractReportTriggerData({
    ...input,
    action: input.action as "SEND_EMAIL" | "SEND_SLACK_MESSAGE" | "SEND_WEBHOOK",
  });

  return {
    ...built,
    action: input.action,
    triggerKind: TriggerKind.REPORT,
    actionParams: built.actionParams as Prisma.InputJsonValue,
    filters: built.filters as Prisma.InputJsonValue,
  };
}

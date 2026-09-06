import { z } from "zod";

import type { AlertType } from "./trigger.ts";

export const testFireChannelSchema = z.enum(["email", "slack", "webhook"]);
export type TestFireChannel = z.infer<typeof testFireChannelSchema>;

export interface TestFireTemplateDraft {
  slackTemplateType?: string | null;
  slackTemplate?: string | null;
  emailSubjectTemplate?: string | null;
  emailBodyTemplate?: string | null;
}

export interface TestFireTriggerIdentity {
  name: string;
  alertType: AlertType | null;
}

export interface TestFireProjectIdentity {
  name: string;
  slug: string;
}

export interface TestFireGraphAlert {
  graphName?: string;
  metricLabel?: string;
  operator?: string;
  threshold?: number;
  timePeriodMinutes?: number;
}

export interface TestFireReport {
  sourceKind: "traceQuery" | "customGraph" | "dashboard";
  scheduleLabel?: string;
}

export interface TestFireWebhookDestination {
  url: string;
  method: "POST" | "PUT" | "PATCH";
  headers: Record<string, string>;
  signingSecrets?: readonly string[];
  bodyTemplate: string | null;
}

export interface TestFireInput {
  channel: TestFireChannel;
  trigger: TestFireTriggerIdentity;
  project: TestFireProjectIdentity;
  draft: TestFireTemplateDraft;
  recipients: string[];
  webhook: string | null;
  botDestination?: { token: string; channel: string } | null;
  webhookDestination?: TestFireWebhookDestination | null;
  graphAlert?: TestFireGraphAlert | null;
  report?: TestFireReport | null;
}

export const testFireResultSchema = z.object({
  channel: testFireChannelSchema,
  recipientCount: z.number(),
  usedDefault: z.boolean(),
  missingVariables: z.array(z.string()),
  errors: z.array(z.string()),
  httpStatus: z.number().optional(),
});
export type TestFireResult = z.infer<typeof testFireResultSchema>;
